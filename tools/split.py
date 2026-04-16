#!/usr/bin/env python3
import os
import argparse
import math
import rasterio
from rasterio.windows import Window

def split_geotiff(input_path, out_dir, tile_size=2048, overlap_ratio=0.2):
    """
    Slices a large GeoTIFF into smaller GeoTIFFs while perfectly 
    preserving the geospatial coordinates for each individual tile.
    """
    if not os.path.exists(out_dir):
        os.makedirs(out_dir)

    # Calculate how many pixels to move forward each step
    stride = int(tile_size * (1 - overlap_ratio))
    base_name = os.path.splitext(os.path.basename(input_path))[0]

    print(f"Opening {input_path}...")
    
    with rasterio.open(input_path) as src:
        meta = src.meta.copy()
        img_width = src.width
        img_height = src.height

        print(f"Original Image Size: {img_width}x{img_height}")
        print(f"Slicing into {tile_size}x{tile_size} tiles with {overlap_ratio*100}% overlap...")

        tile_count = 0

        # Loop through the image in chunks
        for row_off in range(0, img_height, stride):
            for col_off in range(0, img_width, stride):
                
                # Calculate the width and height of this specific tile
                # (Edge tiles might be smaller than the tile_size)
                width = min(tile_size, img_width - col_off)
                height = min(tile_size, img_height - row_off)

                if width <= 0 or height <= 0:
                    continue

                # Define the window
                window = Window(col_off, row_off, width, height)

                # Calculate the new geospatial transform for this specific window
                new_transform = src.window_transform(window)

                # Read the data just for this window
                # We read all bands (e.g., RGB or RGBA)
                tile_data = src.read(window=window)

                # Update the metadata for the new output file
                meta.update({
                    "driver": "GTiff",
                    "height": height,
                    "width": width,
                    "transform": new_transform
                })

                # Generate the output filename
                out_filename = f"{base_name}_tile_{row_off}_{col_off}.tif"
                out_filepath = os.path.join(out_dir, out_filename)

                # Write the new GeoTIFF
                with rasterio.open(out_filepath, "w", **meta) as dest:
                    dest.write(tile_data)

                tile_count += 1

        print(f"\nSuccess! Sliced into {tile_count} individual GeoTIFFs.")
        print(f"Saved to: {os.path.abspath(out_dir)}")


def main():
    parser = argparse.ArgumentParser(description="Split a large GeoTIFF into smaller GeoTIFF tiles.")
    parser.add_argument('--input', required=True, help='Path to the large source .tif file')
    parser.add_argument('--outdir', default='tiled_images', help='Directory to save the new tiles')
    parser.add_argument('--tile_size', type=int, default=1024, help='Width/Height of each tile in pixels (default: 1024)')
    parser.add_argument('--overlap', type=float, default=0.2, help='Overlap ratio between 0.0 and 1.0 (default: 0.2)')
    
    args = parser.parse_args()
    
    split_geotiff(args.input, args.outdir, args.tile_size, args.overlap)

if __name__ == "__main__":
    main()
