#!/usr/bin/env python3
"""Convert the MATLAB example files into JSON for the web application.

    python3 tools/mat2json.py                    convert everything
    python3 tools/mat2json.py --check            re-read the JSON and compare
    python3 tools/mat2json.py --only Heyman      convert the matching ones

WHY THIS EXISTS
    The web version of aLOTofImaginArches runs entirely in the browser, so it
    cannot read MATLAB .mat files: parsing them in JavaScript would mean
    carrying a binary reader for a format we control anyway. Instead the 28
    examples are converted once, here, into plain JSON plus a PNG for the
    background image. The conversion is the point at which the data model of
    the application is pinned down.

WHAT IT PRODUCES
    docs/app/data/examples/<name>.json    the saved state, MATLAB names kept
    docs/app/data/examples/<name>.png     the background image, if present
    docs/app/data/examples/index.json     the catalogue the app loads first

CONVENTIONS
    - MATLAB field names are preserved verbatim. The point of this file is to
      be checkable against the .mat by eye; renaming would defeat that.
    - An empty MATLAB array becomes JSON null, not [] -- in the app "not set"
      and "set to nothing" are different states.
    - 1xN and Nx1 arrays collapse to a flat list; genuine matrices stay nested.
    - The block outlines, a MATLAB cell array of {x, y} rows, become a list of
      {"x": [...], "y": [...]}.

REQUIREMENTS
    scipy, numpy and Pillow. They are not in the system python; the pyLOT
    virtual environment next door has them:

        ../pyLOT/.venv_aLOT/bin/python tools/mat2json.py
"""

import argparse
import datetime
import glob
import json
import os
import sys

try:
    import numpy as np
    import scipy.io
except ImportError:  # pragma: no cover - environment problem, not a bug
    sys.exit("scipy and numpy are required; try "
             "../pyLOT/.venv_aLOT/bin/python tools/mat2json.py")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "Examples")
OUT = os.path.join(ROOT, "docs", "app", "data", "examples")

#: Field carrying the background image; handled separately, never inlined.
IMAGE_FIELD = "ImageFile"

#: Fields that are MATLAB char arrays and must come back as strings.
#: PolenihpSwitch is NOT here: in the newer examples it is a struct with a
#: Value field, not a string, so it goes through the generic path.
CHAR_FIELDS = {"UNISYS", "alphabet_letters", "Folder_Examples", "ImageFileName"}


def _is_empty(v):
    return getattr(v, "size", 1) == 0


def _to_str(v):
    """MATLAB char data -> str. Comes through as uint8 codes or as <U text."""
    if isinstance(v, str):
        return v
    a = np.asarray(v)
    if a.dtype.kind in "US":
        return " ".join(str(x) for x in a.ravel()).strip()
    if a.dtype.names or a.dtype == object:
        # Not a char array after all; let the caller fall back.
        return None
    return "".join(chr(int(c)) for c in a.ravel())


def _convert(v, name=""):
    """One MATLAB value -> something json.dump can write."""
    if _is_empty(v):
        return None
    if name in CHAR_FIELDS:
        text = _to_str(v)
        if text is not None:
            return text

    a = np.asarray(v)

    # A struct: recurse over its fields.
    if a.dtype.names:
        if a.size == 1:
            item = a.ravel()[0]
            return {f: _convert(item[f], f) for f in a.dtype.names}
        return [{f: _convert(row[f], f) for f in a.dtype.names}
                for row in a.ravel()]

    # A cell array. The block outlines are the important case: N rows of
    # {x-vector, y-vector}.
    if a.dtype == object:
        if a.ndim == 2 and a.shape[1] == 2:
            return [{"x": _convert(a[i, 0]), "y": _convert(a[i, 1])}
                    for i in range(a.shape[0])]
        return [_convert(x) for x in a.ravel()]

    if a.dtype.kind in "US":
        return _to_str(a)

    a = a.astype(float)
    if a.ndim == 0:
        return float(a)
    # Squeeze away the singleton axes MATLAB leaves behind: the ray directions
    # arrive as (N, 1, 2) and are much easier to use as (N, 2).
    a = np.squeeze(a)
    if a.ndim == 0:
        return float(a)
    return _nested(a)


def _nested(a):
    """A float array of any rank -> nested lists, with NaN as null."""
    if a.ndim == 1:
        return [None if np.isnan(x) else float(x) for x in a]
    return [_nested(sub) for sub in a]


#: Longest side of a stored background image, in pixels. The images are
#: photographs traced by hand on screen; beyond this they carry no extra
#: information and only slow the page down. The block coordinates are stored
#: in the ORIGINAL pixel frame, so the app rescales the image, never the data.
MAX_IMAGE_SIDE = 1600

#: Quality of the stored JPEG. These are photographs of masonry; PNG is the
#: wrong format for them and costs about ten times the bytes.
JPEG_QUALITY = 82


def _save_image(arr, path):
    """Write the embedded background image. Returns (name, w, h) or None.

    Photographs are stored as JPEG, line drawings and anything with few
    colours as PNG, because a drawing survives PNG losslessly at a fraction of
    a JPEG's size and JPEG would ring around the lines.
    """
    try:
        from PIL import Image
    except ImportError:
        print("      ! Pillow missing: image not written")
        return None
    a = np.asarray(arr)
    if a.ndim == 2:
        img = Image.fromarray(a.astype("uint8"), "L")
    elif a.ndim == 3 and a.shape[2] >= 3:
        img = Image.fromarray(a[:, :, :3].astype("uint8"), "RGB")
    else:
        return None

    full = img.size
    if max(img.size) > MAX_IMAGE_SIDE:
        scale = MAX_IMAGE_SIDE / max(img.size)
        img = img.resize((max(1, round(img.width * scale)),
                          max(1, round(img.height * scale))),
                         Image.LANCZOS)

    base = os.path.splitext(path)[0]
    n_colours = len(img.convert("RGB").getcolors(maxcolors=4096) or [])
    if n_colours and n_colours <= 256:
        out = base + ".png"
        img.save(out, optimize=True)
    else:
        out = base + ".jpg"
        img.convert("RGB").save(out, quality=JPEG_QUALITY, optimize=True,
                                progressive=True)
    return os.path.basename(out), full[0], full[1]


def convert(path):
    """Convert one .mat. Returns the catalogue entry."""
    name = os.path.splitext(os.path.basename(path))[0]
    sv = scipy.io.loadmat(path)["saved_variables"]
    fields = list(sv.dtype.names)

    data, image = {}, None
    for f in fields:
        v = sv[f][0, 0]
        if f == IMAGE_FIELD:
            if not _is_empty(v):
                image = v
            data[f] = None          # replaced by the file reference below
            continue
        data[f] = _convert(v, f)

    os.makedirs(OUT, exist_ok=True)
    entry = {"name": name, "file": name + ".json"}

    if image is not None:
        saved = _save_image(image, os.path.join(OUT, name + ".png"))
        if saved:
            fname, w, h = saved
            data["ImageFileName"] = fname
            # The ORIGINAL pixel size: every coordinate in this file is
            # expressed in that frame, whatever size the stored image has.
            data["ImageSize"] = [w, h]
            entry["image"] = fname

    data["_frame"] = _frame(data)

    nblocks = data.get("Number_of_Blocks")
    entry["blocks"] = int(nblocks[0]) if isinstance(nblocks, list) and nblocks \
        else (int(nblocks) if isinstance(nblocks, float) else None)
    entry["has_thrust_line"] = data.get("LOT_xy") is not None
    entry["units"] = data.get("UNISYS")
    entry["frame"] = data["_frame"]["coordinates"]

    out = {
        "_meta": {
            "source": os.path.basename(path),
            "converted": datetime.date.today().isoformat(),
            "tool": "tools/mat2json.py",
            "note": "MATLAB field names preserved; empty arrays are null.",
        },
        "data": data,
    }
    with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    return entry


def _scalar(v):
    """First number of a field that may be a scalar or a 1-element list."""
    if isinstance(v, list):
        v = v[0] if v else None
    return float(v) if isinstance(v, (int, float)) else None


def _frame(data):
    """Say, explicitly, what frame the coordinates are expressed in.

    THE TRAP THIS EXISTS TO CLOSE. In some examples the block coordinates are
    image PIXELS; in others the user has picked a reference length and scaled
    the model, and the coordinates are PHYSICAL units, while the image is still
    stored at its own pixel size. Nothing in the MATLAB file states which,
    and guessing from the numbers is unreliable -- an arch need not span its
    photograph.

    The rule: current_image_scaling_factor, when present, is the number of
    physical units per pixel and settles the question. When it is absent, the
    coordinates are pixels UNLESS the geometry plainly cannot be pixels, in
    which case the factor is inferred from the extents and flagged as such,
    so the application can warn instead of silently drawing nonsense.
    """
    size = data.get("ImageSize")
    blocks = data.get("Blocks_coordinates_4_points")
    factor = _scalar(data.get("current_image_scaling_factor"))

    if factor:
        return {"coordinates": "physical", "units_per_pixel": factor,
                "inferred": False}
    if not size or not blocks:
        return {"coordinates": "pixels", "units_per_pixel": 1.0,
                "inferred": True}

    xs = [x for b in blocks for x in (b.get("x") or []) if x is not None]
    ys = [y for b in blocks for y in (b.get("y") or []) if y is not None]
    if not xs or not ys:
        return {"coordinates": "pixels", "units_per_pixel": 1.0,
                "inferred": True}

    span = max(max(xs) - min(xs), max(ys) - min(ys))
    image_span = max(size)
    # A traced arch covers a good part of its photograph: a span under a tenth
    # of the image cannot be pixels. The threshold matters -- Poleni_Example_04
    # carries the same geometry as _05, which does record the factor, and a
    # looser bound put the two in different frames.
    if span > image_span / 10.0:
        return {"coordinates": "pixels", "units_per_pixel": 1.0,
                "inferred": True}
    return {"coordinates": "physical",
            "units_per_pixel": round(span / image_span, 6),
            "inferred": True}


def check(path):
    """Re-read the JSON and compare the numeric fields against the .mat."""
    name = os.path.splitext(os.path.basename(path))[0]
    jp = os.path.join(OUT, name + ".json")
    if not os.path.exists(jp):
        return [f"{name}: no JSON"]
    sv = scipy.io.loadmat(path)["saved_variables"]
    data = json.load(open(jp, encoding="utf-8"))["data"]
    problems = []
    for f in sv.dtype.names:
        if f == IMAGE_FIELD:
            continue
        v = sv[f][0, 0]
        if _is_empty(v):
            if data.get(f) is not None:
                problems.append(f"{name}.{f}: should be null")
            continue
        if data.get(f) is None:
            problems.append(f"{name}.{f}: lost in conversion")
            continue
        if f == "_frame":
            continue
        a = np.asarray(v)
        if a.dtype.names or a.dtype == object or f in CHAR_FIELDS:
            continue
        flat_src = a.astype(float).ravel()
        flat_dst = np.asarray(_flatten(data[f]), dtype=float).ravel()
        if flat_src.size != flat_dst.size:
            problems.append(f"{name}.{f}: {flat_src.size} values in, "
                            f"{flat_dst.size} out")
        elif not np.allclose(np.nan_to_num(flat_src), np.nan_to_num(flat_dst)):
            problems.append(f"{name}.{f}: values differ")
    return problems


def _flatten(x):
    if isinstance(x, list):
        out = []
        for i in x:
            out.extend(_flatten(i))
        return out
    return [0.0 if x is None else x]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true",
                    help="verify the JSON against the .mat instead of writing")
    ap.add_argument("--only", help="substring filter on the file name")
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(SRC, "*.mat")))
    if args.only:
        files = [f for f in files if args.only.lower() in f.lower()]
    if not files:
        sys.exit(f"no .mat found in {SRC}")

    if args.check:
        problems = []
        for f in files:
            problems.extend(check(f))
        if problems:
            print(f"{len(problems)} problem(s):")
            for p in problems:
                print("  -", p)
            return 1
        print(f"All {len(files)} examples match their JSON.")
        return 0

    catalogue = []
    for f in files:
        entry = convert(f)
        catalogue.append(entry)
        img = f" + {entry['image']}" if entry.get("image") else ""
        print(f"  {entry['name']}{img}")

    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump({"generated": datetime.date.today().isoformat(),
                   "count": len(catalogue),
                   "examples": catalogue}, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print(f"\n{len(catalogue)} examples written to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
