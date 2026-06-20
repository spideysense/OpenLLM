// swift-tools-version: 5.9
// Dependency versions verified against ml-explore (Apple) repos.
// Add these in Xcode via File > Add Package Dependencies, OR use this manifest
// if you build the chat as a Swift package. For a normal iOS app, prefer adding
// the packages through Xcode's UI and selecting the products listed below.
import PackageDescription

let package = Package(
    name: "Aspen",
    platforms: [.iOS(.v17)],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift", from: "0.25.4"),
        .package(url: "https://github.com/ml-explore/mlx-swift-examples", from: "2.25.4"),
    ],
    targets: [
        .executableTarget(
            name: "Aspen",
            dependencies: [
                .product(name: "MLX", package: "mlx-swift"),
                .product(name: "MLXNN", package: "mlx-swift"),
                .product(name: "MLXLLM", package: "mlx-swift-examples"),
                .product(name: "MLXLMCommon", package: "mlx-swift-examples"),
            ],
            path: "Aspen"
        )
    ]
)
