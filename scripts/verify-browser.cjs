const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const {
  PDFDocument,
  PDFName,
  PDFBool,
  degrees,
  rgb,
  cmyk,
  StandardFonts,
} = require(process.cwd() + "/node_modules/pdf-lib");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const out = require("node:path").resolve(
  process.env.PREFLIGHT_AUDIT_OUTPUT || "output/audit",
);
fs.mkdirSync(out, { recursive: true });
(async () => {
  const doc = await PDFDocument.create();
  const p = doc.addPage([252, 144]);
  p.drawRectangle({
    x: 0,
    y: 0,
    width: 252,
    height: 144,
    color: cmyk(0.9, 0.5, 0.1, 0),
  });
  p.drawRectangle({
    x: 15,
    y: 15,
    width: 100,
    height: 15,
    color: cmyk(0, 0, 0, 1),
  });
  fs.writeFileSync(out + "/card.pdf", await doc.save());
  const judge = await PDFDocument.create();
  const j = judge.addPage([378, 666]);
  j.setTrimBox(9, 9, 360, 648);
  j.setBleedBox(0, 0, 378, 666);
  j.drawRectangle({
    x: 0,
    y: 0,
    width: 378,
    height: 666,
    color: cmyk(0.1, 0.5, 0.6, 0),
  });
  fs.writeFileSync(out + "/judge.pdf", await judge.save());
  const rotated = await PDFDocument.create();
  const rp = rotated.addPage([252, 144]);
  rp.setMediaBox(10, 20, 252, 144);
  rp.setCropBox(10, 20, 252, 144);
  rp.setTrimBox(19, 29, 234, 126);
  rp.setRotation(degrees(90));
  rp.drawRectangle({
    x: 10,
    y: 20,
    width: 252,
    height: 144,
    color: cmyk(0.2, 0, 0.5, 0),
  });
  rp.drawRectangle({
    x: 10,
    y: 20,
    width: 40,
    height: 40,
    color: cmyk(0, 1, 0, 0),
  });
  rp.drawRectangle({
    x: 222,
    y: 124,
    width: 40,
    height: 40,
    color: cmyk(1, 0, 0, 0),
  });
  fs.writeFileSync(out + "/rotated.pdf", await rotated.save());
  const multi = await PDFDocument.create();
  for (const [index, width] of [252, 360].entries()) {
    const pg = multi.addPage([width, 144]);
    pg.drawRectangle({
      x: 0,
      y: 0,
      width,
      height: 144,
      color: index ? rgb(0, 0, 0) : rgb(1, 1, 1),
    });
  }
  fs.writeFileSync(out + "/multi.pdf", await multi.save());
  const asymmetric = await PDFDocument.create();
  const ap = asymmetric.addPage([270, 162]);
  ap.setTrimBox(0, 0, 252, 144);
  ap.setBleedBox(0, 0, 270, 162);
  ap.drawRectangle({ width: 200, height: 100, color: rgb(0, 0, 0) });
  fs.writeFileSync(out + "/asymmetric.pdf", await asymmetric.save());
  const imageSource = await PDFDocument.create();
  const ip = imageSource.addPage([252, 144]);
  const embeddedImage = await imageSource.embedPng(
    fs.readFileSync("public/favicon.png"),
  );
  ip.drawImage(embeddedImage, { x: 0, y: 0, width: 252, height: 144 });
  const nested = await PDFDocument.create();
  const [nestedPage] = await nested.embedPdf(await imageSource.save(), [0]);
  const np = nested.addPage([252, 144]);
  np.drawPage(nestedPage, { x: 0, y: 0, width: 252, height: 144 });
  fs.writeFileSync(out + "/nested.pdf", await nested.save());
  const composite = await PDFDocument.create();
  const cp = composite.addPage([252, 144]);
  cp.drawRectangle({ width: 50, height: 50 });
  cp.node.set(
    PDFName.of("Resources"),
    composite.context.obj({
      Font: {
        F1: {
          Type: "Font",
          Subtype: "Type0",
          BaseFont: "EmbeddedComposite",
          Encoding: "Identity-H",
          DescendantFonts: [
            {
              Type: "Font",
              Subtype: "CIDFontType2",
              FontDescriptor: {
                Type: "FontDescriptor",
                FontName: "EmbeddedComposite",
                FontFile2: composite.context.register(
                  composite.context.flateStream(new Uint8Array([0])),
                ),
              },
            },
          ],
        },
      },
    }),
  );
  fs.writeFileSync(out + "/composite.pdf", await composite.save());
  const overprint = await PDFDocument.create();
  const op = overprint.addPage([252, 144]);
  op.drawRectangle({ width: 100, height: 100 });
  op.node
    .Resources()
    .set(
      PDFName.of("ExtGState"),
      overprint.context.obj({ GS1: { OP: true, op: true } }),
    );
  fs.writeFileSync(out + "/overprint.pdf", await overprint.save());
  const layers = await PDFDocument.load(fs.readFileSync(out + "/card.pdf"));
  layers.catalog.set(PDFName.of("OCProperties"), layers.context.obj({ OCGs: [], D: {} }));
  fs.writeFileSync(out + "/layers.pdf", await layers.save());
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.text().startsWith("VERIFY")) console.log(message.text());
  });
  await page.goto(process.env.PREFLIGHT_BASE_URL || "http://127.0.0.1:5173");
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  const files = Object.fromEntries(
    [
      "card",
      "judge",
      "rotated",
      "multi",
      "asymmetric",
      "nested",
      "composite",
      "overprint",
      "layers",
    ].map((name) => [
      name,
      Array.from(fs.readFileSync(out + "/" + name + ".pdf")),
    ]),
  );
  try {
    const results = await page.evaluate(async (files) => {
      const processor = await import("/src/utils/pdfProcessor.js");
      const { runPreflightChecks, fixBlankPage, fixOverprint } =
        await import("/src/utils/preflightChecker.js");
      const { createCustomerProofPdf } =
        await import("/src/utils/customerProof.js");
      const bug = new File(
        [await (await fetch("/union-bug-black.pdf")).arrayBuffer()],
        "bug.pdf",
        { type: "application/pdf" },
      );
      const outputs = {};
      const checks = {};
      let layersBlocked = false;
      for (const [name, bytes] of Object.entries(files)) {
        console.log("VERIFY " + name);
        const file = new File([new Uint8Array(bytes)], name + ".pdf", {
          type: "application/pdf",
        });
        const proxy = await processor.loadPDF(file);
        checks[name] = await runPreflightChecks(file, proxy);
        if (name === "overprint") {
          const fixed = new File(
            [await fixOverprint(await file.arrayBuffer())],
            name + ".pdf",
          );
          const fixedDoc = await processor.loadPDF(fixed);
          checks.fixedOverprint = await runPreflightChecks(fixed, fixedDoc);
          await fixedDoc.destroy();
        }
        console.log("VERIFY scanned " + name);
        await proxy.destroy();
        if (name === "layers") {
          try { await processor.stitchBugToPDF(file, null, "#000000", { left: 0, top: 0 }, { width: 1, height: 1 }, 1.5, [], 1, 9, false); }
          catch (error) { layersBlocked = error.message.includes("optional content layers"); }
          continue;
        }
        for (const mode of name === "rotated"
          ? ["plain", "bleed", "crop"]
          : name === "card"
            ? ["bleed", "inset", "empty-selection"]
            : ["bleed"]) {
          console.log("VERIFY export " + name + " " + mode);
          const output = await processor.stitchBugToPDF(
            file,
            bug,
            "#000000",
            { left: 30, top: 30 },
            { width: 50, height: 20 },
            1.5,
            mode === "empty-selection" ? [] : [1],
            1,
            mode === "bleed" ? 9 : 0,
            true,
            {},
            {},
            mode === "crop",
            mode === "inset" ? 3 : 0,
          );
          outputs[name + "-" + mode] = Array.from(output);
        }
      }
      outputs["rotated-proof"] = Array.from(
        await createCustomerProofPdf({
          sourcePdfBytes: new Uint8Array(files.rotated),
          proofId: "EST-한글-42",
          sourceName: "명함.pdf",
        }),
      );
      const blank = new File([new Uint8Array(files.card)], "card.pdf");
      let lastPageGuard = false;
      try {
        await fixBlankPage(await blank.arrayBuffer(), 1);
      } catch {
        lastPageGuard = true;
      }
      const canvas = document.createElement("canvas");
      canvas.width = 252;
      canvas.height = 144;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "blue";
      ctx.fillRect(0, 0, 252, 144);
      const image = processor.stitchBugToImage(
        canvas,
        null,
        { left: 0, top: 0 },
        { width: 0, height: 0 },
        0,
        false,
      );
      const bitmap = await createImageBitmap(await (await fetch(image)).blob());
      return {
        outputs,
        checks,
        layersBlocked,
        lastPageGuard,
        imageSize: [bitmap.width, bitmap.height],
      };
    }, files);
    for (const [name, bytes] of Object.entries(results.outputs))
      fs.writeFileSync(out + "/" + name + ".pdf", Buffer.from(bytes));
    assert.equal(results.checks.card.checks.blankPages.status, "pass");
    assert.equal(results.checks.nested.checks.resolution.status, "warning");
    assert.equal(results.checks.nested.checks.colorMode.status, "warning");
    assert.equal(results.checks.composite.checks.fontEmbedding.status, "pass");
    assert.equal(results.checks.overprint.checks.overprint.status, "error");
    assert.equal(results.checks.fixedOverprint.checks.overprint.status, "pass");
    assert.equal(results.checks.asymmetric.checks.bleed.status, "error");
    assert.equal(results.lastPageGuard, true);
    assert.equal(results.layersBlocked, true);
    assert.equal(results.checks.layers.checks.hiddenLayers.fixable, false);
    assert.deepEqual(results.imageSize, [252, 144]);
    const withStamp = await PDFDocument.load(
      Buffer.from(results.outputs["card-bleed"]),
    );
    assert.deepEqual(withStamp.getPage(0).getSize(), {
      width: 270,
      height: 162,
    });
    assert.deepEqual(withStamp.getPage(0).getTrimBox(), {
      x: 9,
      y: 9,
      width: 252,
      height: 144,
    });
    // Real UI upload, scan, replacement, edit, download, image proof, and keyboard flows.
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles(out + "/card.pdf");
    await page.locator(".artwork-canvas canvas").waitFor();
    await page
      .getByRole("button", { name: "Analyze PDF", exact: true })
      .click();
    await page.getByText("No blank pages detected", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Stamper Settings", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Add mirror bleed", exact: true })
      .check();
    await page.locator(".loading-overlay").waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "Union Bug", exact: false })
      .filter({ has: page.locator("strong") })
      .click();
    await page
      .getByRole("checkbox", { name: "Apply Union Bug", exact: true })
      .check();
    await page.locator(".draggable-bug").waitFor();
    // The latest page alignment controls must preserve the other axis.
    const stampPosition = () => page.locator(".draggable-bug").evaluate(element => ({
      left: parseFloat(element.style.left), top: parseFloat(element.style.top),
    }));
    const initialPosition = await stampPosition();
    await page.getByRole("button", { name: "Align left", exact: true }).click();
    const horizontalPosition = await stampPosition();
    assert.equal(horizontalPosition.top, initialPosition.top);
    assert.ok(horizontalPosition.left < initialPosition.left);
    await page.getByRole("button", { name: "Align top", exact: true }).click();
    const verticalPosition = await stampPosition();
    assert.equal(verticalPosition.left, horizontalPosition.left);
    assert.ok(verticalPosition.top < horizontalPosition.top);
    await page.locator(".draggable-bug").focus();
    await page.keyboard.press("ArrowLeft");
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save Production File", exact: true })
      .click();
    const download = await downloadPromise;
    await download.saveAs(out + "/ui-card-production.pdf");
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles(out + "/judge.pdf");
    await page.getByText('5.00" × 9.00"', { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Bleed & Trim", exact: false })
      .click();
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Add mirror bleed", exact: true })
        .isChecked(),
      false,
    );
    const unchanged = await page.locator(".artwork-filename").textContent();
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["x"], "bad.txt", { type: "text/plain" }));
      window.dispatchEvent(
        new DragEvent("drop", { dataTransfer: data, bubbles: true }),
      );
    });
    await page.getByRole("alert").filter({ hasText: "Choose a PDF" }).waitFor();
    assert.equal(
      await page.locator(".artwork-filename").textContent(),
      unchanged,
    );
    const imagePath = out + "/image.png";
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 252;
      c.height = 144;
      c.getContext("2d").fillRect(0, 0, 126, 144);
      window.testPng = c.toDataURL();
    });
    fs.writeFileSync(
      imagePath,
      Buffer.from(
        (await page.evaluate(() => window.testPng)).split(",")[1],
        "base64",
      ),
    );
    await page.locator("input[type=file]").first().setInputFiles(imagePath);
    await page.locator(".artwork-canvas canvas").waitFor();
    if (
      (await page
        .getByRole("checkbox", { name: "Add mirror bleed", exact: true })
        .count()) === 0
    )
      await page
        .getByRole("button", { name: "Bleed & Trim", exact: false })
        .click();
    await page
      .getByRole("checkbox", { name: "Add mirror bleed", exact: true })
      .check();
    await page.locator(".loading-overlay").waitFor({ state: "hidden" });
    const preview = await page
      .locator(".artwork-canvas canvas")
      .evaluate((c) => [c.width, c.height]);
    assert.deepEqual(preview, [328, 220]);
    assert.deepEqual(await page.locator(".artwork-canvas canvas").evaluate(canvas =>
      Array.from(canvas.getContext("2d").getImageData(canvas.width - 1, Math.floor(canvas.height / 2), 1, 1).data)
    ), [255, 255, 255, 255]);
    const pngDownloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save Production File", exact: true })
      .click();
    const pngDownload = await pngDownloadPromise;
    await pngDownload.saveAs(out + "/ui-image.png");
    const exportedImageSize = await page.evaluate(async bytes => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
      return [image.width, image.height];
    }, Array.from(fs.readFileSync(out + "/ui-image.png")));
    assert.deepEqual(exportedImageSize, preview);
    await page.locator("#proof-id").fill("EST-42");
    const proofPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Create Customer Proof PDF", exact: true })
      .click();
    await (await proofPromise).saveAs(out + "/ui-image-proof.pdf");
    // Mixed page sizes/backgrounds: all-page export must align and color each stamp independently.
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles(out + "/multi.pdf");
    await page.locator(".artwork-canvas canvas").waitFor();
    await page
      .getByRole("button", { name: "Union Bug", exact: false })
      .filter({ has: page.locator("strong") })
      .click();
    await page
      .getByRole("checkbox", { name: "Apply Union Bug", exact: true })
      .check();
    await page.locator(".draggable-bug").waitFor();
    await page
      .getByRole("combobox", { name: "Apply Union Bug to pages", exact: true })
      .selectOption("all");
    const multiDownloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save Production File", exact: true })
      .click();
    await (await multiDownloadPromise).saveAs(out + "/ui-multi.pdf");
    await page
      .getByRole("combobox", { name: "Apply Union Bug to pages", exact: true })
      .selectOption("last");
    await page.locator(".draggable-bug").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await page.locator(".draggable-bug").waitFor();
    await page
      .getByRole("button", { name: "Show page previews", exact: true })
      .click();
    assert.equal(await page.locator(".page-thumbnail-item").count(), 2);
    await page.getByRole("button", { name: "Preflight", exact: true }).click();
    await page
      .getByRole("button", { name: "Analyze PDF", exact: true })
      .click();
    await page.getByText("No blank pages detected", { exact: true }).waitFor();
    for (const [name, size, theme] of [
      ["desktop", { width: 1440, height: 900 }, "dark"],
      ["mobile", { width: 375, height: 812 }, "light"],
      ["landscape", { width: 812, height: 375 }, "dark"],
    ]) {
      await page.setViewportSize(size);
      await page
        .getByRole("button", { name: "Use " + theme + " theme", exact: true })
        .click();
      await page.screenshot({
        path: out + "/" + name + ".png",
        fullPage: true,
        animations: "disabled",
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "no horizontal overflow: " + name,
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          checks: Object.fromEntries(
            Object.entries(results.checks).map(([n, r]) => [
              n,
              {
                blank: r.checks.blankPages.status,
                bleed: r.checks.bleed.status,
              },
            ]),
          ),
          outputs: Object.keys(results.outputs),
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
