// swift-tools-version: 6.3

import PackageDescription

let package = Package(
    name: "CodezalMLXBridge",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(name: "CodezalMLXBridge", type: .dynamic, targets: ["CodezalMLXBridge"]),
        .executable(name: "CodezalMLXHelper", targets: ["CodezalMLXHelper"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift-lm", .upToNextMajor(from: "3.31.3")),
        .package(url: "https://github.com/huggingface/swift-huggingface", from: "0.9.0"),
        .package(url: "https://github.com/huggingface/swift-transformers", from: "1.3.0"),
    ],
    targets: [
        .target(
            name: "CodezalMLXBridge",
            dependencies: [
                .product(name: "MLXLLM", package: "mlx-swift-lm"),
                .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
                .product(name: "MLXHuggingFace", package: "mlx-swift-lm"),
                .product(name: "HuggingFace", package: "swift-huggingface"),
                .product(name: "Tokenizers", package: "swift-transformers"),
            ]
        ),
        .executableTarget(
            name: "CodezalMLXHelper",
            dependencies: ["CodezalMLXBridge"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
