#!/bin/sh

set -ex

xattr -r -d com.apple.quarantine termcast-darwin-arm64
