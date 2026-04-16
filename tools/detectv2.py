#!/usr/bin/env python3
import os
import argparse
import glob
import re
import cv2
import numpy as np
import rasterio
import pandas as pd
from pyproj import Transformer
from ultralytics import YOLO

def read_geotiff_as_bgr(path: str):
    """Reads a GeoTIFF and scales it robustly to 8-bit BGR for YOLO inference."""
    with rasterio.open(path) as src:
        transform = src.transform
        crs = src.crs
        count = src.count

        if count == 1:
            band = src.read(1).astype(np.float32)
            lo, hi = np.nanpercentile(band, (1, 99))
            if not np.isfinite(lo): lo = np.nanmin(band)
            if not np.isfinite(hi): hi = np.nanmax(band)
            if hi <= lo: hi = lo + 1.0
            band8 = np.clip((band - lo) * 255.0 / (hi - lo), 0, 255).astype(np.uint8)
            return cv2.cvtColor(band8, cv2.COLOR_GRAY2BGR), transform, crs

        rgb = src.read([1, 2, 3]).astype(np.float32)
        out = np.zeros_like(rgb, dtype=np.uint8)
        for i in range(3):
            band = rgb[i]
            lo, hi = np.nanpercentile(band, (1, 99))
            if not np.isfinite(lo): lo = np.nanmin(band)
            if not np.isfinite(hi): hi = np.nanmax(band)
            if hi <= lo: hi = lo + 1.0
            out[i] = np.clip((band - lo) * 255.0 / (hi - lo), 0, 255).astype(np.uint8)

        img_rgb = np.transpose(out, (1, 2, 0))
        return cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR), transform, crs

def get_offsets_from_filename(filename):
    """Extracts the row and column pixel offsets from the tile filename."""
    match = re.search(r'_tile_(\d+)_(\d+)\.tif$', filename, re.IGNORECASE)
    if match:
        return int(match.group(1)), int(match.group(2))
    return 0, 0

def px_to_lonlat(px_x, px_y, transform, transformer):
    """Converts a local pixel coordinate to real-world Lat/Lon."""
    if transform is None or transformer is None:
        return None, None
    map_x, map_y = rasterio.transform.xy(transform, px_y, px_x, offset="center")
    lon, lat = transformer.transform(map_x, map_y)
    return lat, lon

def custom_nms_keep_largest(boxes, scores, iou_thresh=0.5):
    """
    Custom NMS that always prioritizes the LARGER bounding box.
    Uses 'Intersection over Smaller Area' to perfectly filter tile-edge cutoffs.
    """
    if len(boxes) == 0:
        return []

    boxes = np.array(boxes) # [xmin, ymin, xmax, ymax]
    scores = np.array(scores)
    
    # Calculate area of all boxes
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])

    # 1. Sort by AREA descending (Largest boxes first)
    order = areas.argsort()[::-1]

    keep = []
    while order.size > 0:
        i = order[0] # Index of the largest remaining box
        keep.append(i) # Keep it

        if order.size == 1:
            break

        # Compare this largest box with all remaining smaller boxes
        xx1 = np.maximum(boxes[i, 0], boxes[order[1:], 0])
        yy1 = np.maximum(boxes[i, 1], boxes[order[1:], 1])
        xx2 = np.minimum(boxes[i, 2], boxes[order[1:], 2])
        yy2 = np.minimum(boxes[i, 3], boxes[order[1:], 3])

        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h

        # Calculate Intersection over Smaller Area (IoS)
        smaller_areas = areas[order[1:]]
        ios = inter / smaller_areas

        # Also calculate standard IoU (for overlapping boxes of similar size)
        union = areas[i] + smaller_areas - inter
        iou = inter / union

        # If either metric exceeds threshold, the small box is a duplicate/cut-off piece
        overlap = np.maximum(ios, iou)

        # Keep only boxes that do NOT overlap heavily with our large kept box
        inds = np.where(overlap <= iou_thresh)[0]
        order = order[inds + 1]

    return keep

def main():
    parser = argparse.ArgumentParser(description="Run YOLO on tiled GeoTIFFs, prioritize large boxes, format Excel.")
    parser.add_argument('--model', required=True, help='Path to YOLO model (.pt)')
    parser.add_argument('--source', required=True, help='Directory containing the tiled .tif files')
    parser.add_argument('--thresh', type=float, default=0.4, help='Minimum confidence threshold (default: 0.4)')
    # Default set to 0.5 because IoS handles cut-pieces aggressively and beautifully
    parser.add_argument('--nms_thresh', type=float, default=0.5, help='Overlap threshold for duplicate removal (default: 0.5)')
    parser.add_argument('--output', default='Unified_Tree_Detections.xlsx', help='Output Excel filename')
    parser.add_argument('--outdir', default='detected_tilesv2', help='Directory to save output images')
    
    args = parser.parse_args()

    os.makedirs(args.outdir, exist_ok=True)

    print(f"Loading YOLO model: {args.model}")
    model = YOLO(args.model, task='detect')
    labels = model.names

    tile_files = glob.glob(os.path.join(args.source, "*.tif"))
    if not tile_files:
        print(f"ERROR: No .tif files found in {args.source}")
        return

    total_tiles = len(tile_files)
    print(f"Found {total_tiles} tiles. Starting inference...\n")

    all_global_boxes = [] 
    all_scores = []
    all_metadata = []     

    bbox_colors = [(164, 120, 87), (68, 148, 228), (93, 97, 209), (178, 182, 133), (88, 159, 106),
                   (96, 202, 231), (159, 124, 168), (169, 162, 241), (98, 118, 150), (172, 176, 184)]

    # 1. Process every tile
    for index, filepath in enumerate(tile_files, start=1):
        filename = os.path.basename(filepath)
        print(f"Processing tile {index}/{total_tiles}: {filename}...", end="\r")
        
        row_off, col_off = get_offsets_from_filename(filename)
        
        try:
            frame, transform, crs = read_geotiff_as_bgr(filepath)
        except Exception as e:
            print(f"\nSkipping {filename} due to read error: {e}")
            continue

        transformer = None
        if crs is not None:
            transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

        results = model(frame, verbose=False)
        boxes = results[0].boxes

        objects_in_tile = 0

        for i in range(len(boxes)):
            conf = float(boxes[i].conf.item())
            if conf < args.thresh: continue

            objects_in_tile += 1
            classidx = int(boxes[i].cls.item())
            classname = labels[classidx]

            xyxy = boxes[i].xyxy.cpu().numpy().squeeze()
            if xyxy.ndim == 0: continue
            if xyxy.ndim == 1: xmin, ymin, xmax, ymax = xyxy
            else: xmin, ymin, xmax, ymax = xyxy[0]

            # --- DRAWING ON THE IMAGE ---
            color = bbox_colors[classidx % 10]
            cv2.rectangle(frame, (int(xmin), int(ymin)), (int(xmax), int(ymax)), color, 2)
            label = f'{classname}: {int(conf * 100)}%'
            labelSize, baseLine = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            label_ymin = max(int(ymin), labelSize[1] + 10)
            cv2.rectangle(frame, (int(xmin), label_ymin - labelSize[1] - 10),
                          (int(xmin) + labelSize[0], label_ymin + baseLine - 10), color, cv2.FILLED)
            cv2.putText(frame, label, (int(xmin), label_ymin - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)

            # --- DATA COLLECTION FOR EXCEL ---
            g_xmin = int(xmin + col_off)
            g_ymin = int(ymin + row_off)
            g_xmax = int(xmax + col_off)
            g_ymax = int(ymax + row_off)

            c_x, c_y = (xmin + xmax) / 2.0, (ymin + ymax) / 2.0
            center_lat, center_lon = px_to_lonlat(c_x, c_y, transform, transformer)

            tl_lat, tl_lon = px_to_lonlat(xmin, ymin, transform, transformer)
            tr_lat, tr_lon = px_to_lonlat(xmax, ymin, transform, transformer)
            br_lat, br_lon = px_to_lonlat(xmax, ymax, transform, transformer)
            bl_lat, bl_lon = px_to_lonlat(xmin, ymax, transform, transformer)

            # Save global coordinates as [xmin, ymin, xmax, ymax] for our custom NMS
            all_global_boxes.append([g_xmin, g_ymin, g_xmax, g_ymax])
            all_scores.append(conf)
            
            all_metadata.append({
                "class": classname,
                "confidence": conf,
                "center_lat": center_lat,
                "center_lon": center_lon,
                "xmin_px": g_xmin,
                "ymin_px": g_ymin,
                "xmax_px": g_xmax,
                "ymax_px": g_ymax,
                "tl_lat": tl_lat,
                "tl_lon": tl_lon,
                "tr_lat": tr_lat,
                "tr_lon": tr_lon,
                "br_lat": br_lat,
                "br_lon": br_lon,
                "bl_lat": bl_lat,
                "bl_lon": bl_lon,
            })

        cv2.putText(frame, f'Trees found: {objects_in_tile}', (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
        out_image_path = os.path.join(args.outdir, f"det_{filename}")
        cv2.imwrite(out_image_path.replace('.tif', '.png'), frame)

    print("\n\nInference complete!")
    if not all_global_boxes:
        print("No trees detected in any tiles.")
        return

    print(f"Raw detections found (including cut slivers): {len(all_global_boxes)}")
    print("Running Custom Area-Based Filtering (keeping largest boxes)...")

    # 2. CUSTOM FILTERING: Prioritize Area over Confidence
    kept_indices = custom_nms_keep_largest(all_global_boxes, all_scores, iou_thresh=args.nms_thresh)

    final_detections = []
    if len(kept_indices) > 0:
        for idx in kept_indices:
            raw_data = all_metadata[idx]
            
            ordered_row = {
                "object_id": len(final_detections) + 1,
                "class": raw_data["class"],
                "confidence": raw_data["confidence"],
                "center_lat": raw_data["center_lat"],
                "center_lon": raw_data["center_lon"],
                "xmin_px": raw_data["xmin_px"],
                "ymin_px": raw_data["ymin_px"],
                "xmax_px": raw_data["xmax_px"],
                "ymax_px": raw_data["ymax_px"],
                "tl_lat": raw_data["tl_lat"],
                "tl_lon": raw_data["tl_lon"],
                "tr_lat": raw_data["tr_lat"],
                "tr_lon": raw_data["tr_lon"],
                "br_lat": raw_data["br_lat"],
                "br_lon": raw_data["br_lon"],
                "bl_lat": raw_data["bl_lat"],
                "bl_lon": raw_data["bl_lon"]
            }
            final_detections.append(ordered_row)

    final_count = len(final_detections)
    print(f"Final true tree count: {final_count}")
    
    # 3. Export to Excel
    df = pd.DataFrame(final_detections)
    try:
        df.to_excel(args.output, index=False)
        print(f"Success! Saved formatted coordinates to: {os.path.abspath(args.output)}")
        print(f"Success! Saved annotated images to: {os.path.abspath(args.outdir)}")
    except ImportError:
        print("\nERROR: Missing 'openpyxl' library required to save Excel files.")
        print("Run this command to fix it: pip install openpyxl")

if __name__ == "__main__":
    main()