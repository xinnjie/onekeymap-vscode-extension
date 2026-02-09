.PHONY: all help install proto compile watch package build test test-unit lint clean

all: build

help:
	@echo "Available targets:"
	@echo "  install    - Install dependencies using pnpm"
	@echo "  proto      - Generate gRPC code from proto files"
	@echo "  compile    - Compile the extension (development build)"
	@echo "  watch      - Compile and watch for changes"
	@echo "  package    - Package the extension (production build)"
	@echo "  build      - Alias for package"
	@echo "  test       - Run all tests (including integration)"
	@echo "  test-unit  - Run unit tests using mocha"
	@echo "  lint       - Run ESLint"
	@echo "  clean      - Remove dist and out directories"

# Install dependencies
install:
	pnpm install

# Generate proto files
proto:
	pnpm run gen:proto

# Compile the extension (development)
compile:
	pnpm run compile

# Watch for changes
watch:
	pnpm run watch

# Package the extension (production build)
package:
	pnpm run package

# Alias for package
build: package

# Run all tests (including integration tests)
test:
	pnpm run test

# Run unit tests only
test-unit:
	pnpm run test:unit

# Run linting
lint:
	pnpm run lint

# Clean build artifacts
clean:
	rm -rf dist out
