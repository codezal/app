use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

fn main() {
    build_mlx_bridge();
    tauri_build::build()
}

fn build_mlx_bridge() {
    if env::var_os("CARGO_FEATURE_LLM_MLX").is_none()
        || env::var("CARGO_CFG_TARGET_OS").ok().as_deref() != Some("macos")
    {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let package_dir = manifest_dir.join("mlx-bridge");
    let scratch_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("mlx-bridge-build");
    let status = Command::new("swift")
        .args(["build", "-c", "release", "--package-path"])
        .arg(&package_dir)
        .arg("--scratch-path")
        .arg(&scratch_dir)
        .status()
        .expect("failed to start swift build for mlx-bridge");

    if !status.success() {
        panic!("swift build failed for mlx-bridge");
    }

    let dylib = [
        scratch_dir.join("arm64-apple-macosx/release/libCodezalMLXBridge.dylib"),
        scratch_dir.join("release/libCodezalMLXBridge.dylib"),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .or_else(|| find_file(&scratch_dir, "libCodezalMLXBridge.dylib"))
    .expect("failed to find MLX bridge dylib after swift build");
    let out_dir = manifest_dir.join("resources").join("mlx");
    fs::create_dir_all(&out_dir).expect("failed to create resources/mlx");
    let bundled_dylib = out_dir.join("libCodezalMLXBridge.dylib");
    copy_if_different(&dylib, &bundled_dylib)
        .expect("failed to copy MLX bridge dylib into resources/mlx");

    let helper = [
        scratch_dir.join("arm64-apple-macosx/release/CodezalMLXHelper"),
        scratch_dir.join("release/CodezalMLXHelper"),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .or_else(|| find_file(&scratch_dir, "CodezalMLXHelper"))
    .expect("failed to find MLX helper after swift build");
    let bundled_helper = out_dir.join("CodezalMLXHelper");
    copy_if_different(&helper, &bundled_helper)
        .expect("failed to copy MLX helper into resources/mlx");
    sign_mlx_binary(&bundled_dylib);
    sign_mlx_binary(&bundled_helper);

    let target_profile_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"))
        .ancestors()
        .nth(3)
        .expect("failed to resolve Cargo target profile dir")
        .to_path_buf();
    let bundled_metallib = out_dir.join("mlx.metallib");
    let metallib = find_mlx_metallib(&target_profile_dir)
        .or_else(|| {
            bundled_metallib
                .is_file()
                .then_some(bundled_metallib.clone())
        })
        .or_else(|| build_mlx_metallib_from_checkout(&scratch_dir))
        .expect("failed to find mlx.metallib after building MLX dependency");
    copy_if_different(&metallib, &out_dir.join("mlx.metallib"))
        .expect("failed to copy MLX metallib into resources/mlx");

    println!("cargo:rerun-if-changed=mlx-bridge/Package.swift");
    println!("cargo:rerun-if-changed=mlx-bridge/Sources/CodezalMLXBridge/CodezalMLXBridge.swift");
    println!("cargo:rerun-if-changed=mlx-bridge/Sources/CodezalMLXHelper/main.swift");
    println!("cargo:rerun-if-env-changed=APPLE_SIGNING_IDENTITY");
}

fn sign_mlx_binary(path: &Path) {
    let Ok(identity) = env::var("APPLE_SIGNING_IDENTITY") else {
        return;
    };
    let identity = identity.trim();
    if identity.is_empty() {
        return;
    }

    println!(
        "cargo:warning=Signing bundled MLX binary: {}",
        path.display()
    );
    let status = Command::new("codesign")
        .args(["--force", "--options", "runtime", "--timestamp", "--sign"])
        .arg(identity)
        .arg(path)
        .status()
        .expect("failed to start codesign for bundled MLX binary");

    if !status.success() {
        panic!("codesign failed for bundled MLX binary: {}", path.display());
    }
}

fn copy_if_different(src: &std::path::Path, dest: &std::path::Path) -> std::io::Result<()> {
    let needs_copy = match (fs::metadata(src), fs::metadata(dest)) {
        (Ok(src_meta), Ok(dest_meta)) if src_meta.len() == dest_meta.len() => {
            fs::read(src)? != fs::read(dest)?
        }
        (Ok(_), Ok(_)) => true,
        (Ok(_), Err(e)) if e.kind() == std::io::ErrorKind::NotFound => true,
        (_, _) => true,
    };

    if needs_copy {
        fs::copy(src, dest)?;
    }
    Ok(())
}

fn find_mlx_metallib(target_profile_dir: &std::path::Path) -> Option<PathBuf> {
    let build_dir = target_profile_dir.join("build");
    for entry in fs::read_dir(&build_dir).ok()? {
        let path = entry.ok()?.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name.starts_with("mlxrs-sys-") {
            continue;
        }

        for candidate in [
            path.join("out").join("lib").join("mlx.metallib"),
            path.join("out")
                .join("build")
                .join("_deps")
                .join("mlx-build")
                .join("mlx")
                .join("backend")
                .join("metal")
                .join("kernels")
                .join("mlx.metallib"),
        ] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    find_file(target_profile_dir, "mlx.metallib")
}

fn build_mlx_metallib_from_checkout(scratch_dir: &std::path::Path) -> Option<PathBuf> {
    let mlx_source = scratch_dir
        .join("checkouts")
        .join("mlx-swift")
        .join("Source")
        .join("Cmlx")
        .join("mlx");
    if !mlx_source.is_dir() {
        return None;
    }

    let build_dir = scratch_dir.join("mlx-metallib-cmake");
    let configure = Command::new("cmake")
        .arg("-S")
        .arg(&mlx_source)
        .arg("-B")
        .arg(&build_dir)
        .args([
            "-DCMAKE_BUILD_TYPE=Release",
            "-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0",
            "-DMLX_BUILD_TESTS=OFF",
            "-DMLX_BUILD_EXAMPLES=OFF",
            "-DMLX_BUILD_BENCHMARKS=OFF",
            "-DMLX_BUILD_PYTHON_BINDINGS=OFF",
            "-DMLX_BUILD_GGUF=OFF",
            "-DMLX_BUILD_SAFETENSORS=OFF",
            "-DMLX_BUILD_METAL=ON",
            "-DMLX_BUILD_CPU=OFF",
            "-DMLX_USE_CCACHE=OFF",
        ])
        .status()
        .ok()?;
    if !configure.success() {
        return None;
    }

    let mut build = Command::new("cmake");
    build
        .args(["--build"])
        .arg(&build_dir)
        .args(["--target", "mlx-metallib"]);
    if let Ok(jobs) = env::var("NUM_JOBS") {
        build.args(["--parallel", &jobs]);
    }
    let status = build.status().ok()?;
    if !status.success() {
        return None;
    }

    find_file(&build_dir, "mlx.metallib")
}

fn find_file(dir: &std::path::Path, file_name: &str) -> Option<PathBuf> {
    for entry in fs::read_dir(dir).ok()? {
        let path = entry.ok()?.path();
        if path
            .components()
            .any(|part| part.as_os_str() == "libCodezalMLXBridge.dylib.dSYM")
        {
            continue;
        }
        if path.file_name().and_then(|name| name.to_str()) == Some(file_name) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file(&path, file_name) {
                return Some(found);
            }
        }
    }
    None
}
