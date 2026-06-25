#!/usr/bin/env python3
import argparse
import subprocess
import tempfile
from pathlib import Path

from PIL import Image
from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.generic import RectangleObject
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def run(cmd):
    subprocess.run(cmd, check=True)


def build_mirror_background(rendered_page, bleed_px):
    src = Image.open(rendered_page).convert("RGB")
    width, height = src.size
    out = Image.new("RGB", (width + bleed_px * 2, height + bleed_px * 2), "white")

    out.paste(src, (bleed_px, bleed_px))

    out.paste(src.crop((0, 0, bleed_px, height)).transpose(Image.Transpose.FLIP_LEFT_RIGHT), (0, bleed_px))
    out.paste(src.crop((width - bleed_px, 0, width, height)).transpose(Image.Transpose.FLIP_LEFT_RIGHT), (bleed_px + width, bleed_px))
    out.paste(src.crop((0, 0, width, bleed_px)).transpose(Image.Transpose.FLIP_TOP_BOTTOM), (bleed_px, 0))
    out.paste(src.crop((0, height - bleed_px, width, height)).transpose(Image.Transpose.FLIP_TOP_BOTTOM), (bleed_px, bleed_px + height))

    out.paste(
        src.crop((0, 0, bleed_px, bleed_px)).transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        (0, 0),
    )
    out.paste(
        src.crop((width - bleed_px, 0, width, bleed_px)).transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        (bleed_px + width, 0),
    )
    out.paste(
        src.crop((0, height - bleed_px, bleed_px, height)).transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        (0, bleed_px + height),
    )
    out.paste(
        src.crop((width - bleed_px, height - bleed_px, width, height))
        .transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        .transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        (bleed_px + width, bleed_px + height),
    )

    return out


def make_background_pdf(input_pdf, page_count, bleed_pt, dpi, temp_dir):
    bg_pdf = temp_dir / "mirror-background.pdf"
    c = canvas.Canvas(str(bg_pdf))
    bleed_px = max(1, round(bleed_pt * dpi / 72))

    for page_num in range(1, page_count + 1):
      prefix = temp_dir / f"page-{page_num}"
      run([
          "pdftoppm",
          "-f",
          str(page_num),
          "-l",
          str(page_num),
          "-png",
          "-r",
          str(dpi),
          str(input_pdf),
          str(prefix),
      ])

      rendered = temp_dir / f"page-{page_num}-{page_num}.png"
      mirrored = build_mirror_background(rendered, bleed_px)
      image_path = temp_dir / f"page-{page_num}-mirror.jpg"
      mirrored.save(image_path, "JPEG", quality=92, optimize=True)

      width_px, height_px = mirrored.size
      page_width_pt = width_px * 72 / dpi
      page_height_pt = height_px * 72 / dpi
      c.setPageSize((page_width_pt, page_height_pt))
      c.drawImage(ImageReader(str(image_path)), 0, 0, width=page_width_pt, height=page_height_pt)
      c.showPage()

    c.save()
    return bg_pdf


def add_true_mirror_bleed(input_pdf, output_pdf, bleed_pt=9.0, dpi=300):
    input_pdf = Path(input_pdf)
    output_pdf = Path(output_pdf)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(str(input_pdf))
    page_count = len(reader.pages)

    with tempfile.TemporaryDirectory(prefix="true-mirror-bleed-") as temp_name:
        temp_dir = Path(temp_name)
        bg_pdf = make_background_pdf(input_pdf, page_count, bleed_pt, dpi, temp_dir)
        bg_reader = PdfReader(str(bg_pdf))
        writer = PdfWriter()

        for index, original_page in enumerate(reader.pages):
            bg_page = bg_reader.pages[index]
            crop = original_page.cropbox
            width = float(crop.width)
            height = float(crop.height)
            new_width = width + bleed_pt * 2
            new_height = height + bleed_pt * 2

            bg_page.merge_transformed_page(
                original_page,
                Transformation().translate(tx=bleed_pt - float(crop.left), ty=bleed_pt - float(crop.bottom)),
                over=True,
            )
            bg_page.mediabox = RectangleObject([0, 0, new_width, new_height])
            bg_page.cropbox = RectangleObject([0, 0, new_width, new_height])
            bg_page.bleedbox = RectangleObject([0, 0, new_width, new_height])
            bg_page.trimbox = RectangleObject([bleed_pt, bleed_pt, bleed_pt + width, bleed_pt + height])
            writer.add_page(bg_page)

        with output_pdf.open("wb") as handle:
            writer.write(handle)


def main():
    parser = argparse.ArgumentParser(description="Add true mirrored bleed to a large PDF while preserving original page content.")
    parser.add_argument("input_pdf")
    parser.add_argument("output_pdf")
    parser.add_argument("--bleed-pt", type=float, default=9.0)
    parser.add_argument("--dpi", type=int, default=300)
    args = parser.parse_args()
    add_true_mirror_bleed(args.input_pdf, args.output_pdf, args.bleed_pt, args.dpi)


if __name__ == "__main__":
    main()
