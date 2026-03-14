# Core Images for Image Track Testing

This directory contains placeholder core images for testing the image track functionality.

## Files Created:
- `CoreImage-0x0.png` - 1x1 pixel placeholder (red)
- `CoreImage-0x1.png` - 1x1 pixel placeholder (green) 
- `CoreImage-1x0.png` - 1x1 pixel placeholder (blue)
- `CoreImage-1x1.png` - 1x1 pixel placeholder (purple)

## Usage:
These images are used by the RasterLog formatter in the time-based track component.
The formatter constructs image paths like: `CoreImage-{i}x{j}.png` where:
- `i` = horizontal tile index
- `j` = vertical tile index

## For Real Implementation:
Replace these placeholder images with your actual core images following the same naming pattern:
- CoreImage-0x0.png, CoreImage-0x1.png, CoreImage-0x2.png, etc.
- CoreImage-1x0.png, CoreImage-1x1.png, CoreImage-1x2.png, etc.

## Image Specifications:
- Recommended size: 720x2480 pixels (as per GeoToolkit example)
- Format: PNG
- Naming: CoreImage-{row}x{col}.png
