import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { convertSpotColorsInContent, convertSpotColorsToCmyk } from '../src/utils/pdfSpotConversion.js';

function streamText(doc, ref) {
  const stream = doc.context.lookup(ref);
  return new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
}

test('convertSpotColorsInContent rewrites a selected Separation spot to its tint-transform CMYK equivalent', async () => {
  const doc = await PDFDocument.create();
  const resources = doc.context.obj({ ColorSpace: {
    Spot1: ['Separation', 'Spot1', 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 }]
  } });
  const lookup = value => doc.context.lookup(value);
  const result = convertSpotColorsInContent('/Spot1 cs 1 scn 0 0 10 10 re f', resources, lookup, new Set(['/Spot1']));
  assert.equal(result.text, '/Spot1 cs 0 0 0 1 k 0 0 10 10 re f');
  assert.deepEqual([...result.converted], ['/Spot1']);
  assert.equal(result.unconverted.size, 0);
});

test('convertSpotColorsInContent leaves a spot untouched when it is not operator-selected', () => {
  const doc = PDFDocument.create();
  return doc.then(doc => {
    const resources = doc.context.obj({ ColorSpace: {
      Spot1: ['Separation', 'Spot1', 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 }]
    } });
    const lookup = value => doc.context.lookup(value);
    const source = '/Spot1 cs 1 scn 0 0 10 10 re f';
    const result = convertSpotColorsInContent(source, resources, lookup, new Set(['/SomeOtherSpot']));
    assert.equal(result.text, source);
    assert.equal(result.converted.size, 0);
  });
});

test('convertSpotColorsInContent refuses (reports, does not guess) an unsupported alternate space', async () => {
  const doc = await PDFDocument.create();
  const resources = doc.context.obj({ ColorSpace: {
    Spot1: ['Separation', 'Spot1', 'Lab', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0], C1: [100, 0, 0], N: 1 }]
  } });
  const lookup = value => doc.context.lookup(value);
  const source = '/Spot1 cs 1 scn 0 0 10 10 re f';
  const result = convertSpotColorsInContent(source, resources, lookup, new Set(['/Spot1']));
  assert.equal(result.text, source); // untouched
  assert.deepEqual([...result.unconverted], ['/Spot1']);
  assert.equal(result.converted.size, 0);
});

test('convertSpotColorsInContent never treats a three-channel Lab ICC profile as RGB', async () => {
  const doc = await PDFDocument.create();
  const profile = doc.context.register(doc.context.flateStream('spacLab Lab ', { N: 3 }));
  const resources = doc.context.obj({ ColorSpace: {
    Spot1: ['Separation', 'Spot1', ['ICCBased', profile], {
      FunctionType: 2, Domain: [0, 1], C0: [100, 0, 0], C1: [74.1176, -1, -1], N: 1,
      Range: [0, 100, -128, 127, -128, 127]
    }]
  } });
  const source = '/Spot1 cs 1 scn 0 0 10 10 re f';
  const result = convertSpotColorsInContent(source, resources, value => doc.context.lookup(value), new Set(['/Spot1']));
  assert.equal(result.text, source);
  assert.deepEqual([...result.unconverted], ['/Spot1']);
  assert.equal(result.converted.size, 0);
});

test('convertSpotColorsInContent refuses malformed CMYK tint values', async () => {
  const doc = await PDFDocument.create();
  for (const values of [[0, 1, 0], [0, 0, 0, 2]]) {
    const resources = doc.context.obj({ ColorSpace: {
      Spot1: ['Separation', 'Spot1', 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: values, C1: values, N: 1 }]
    } });
    const source = '/Spot1 cs 1 scn 0 0 10 10 re f';
    const result = convertSpotColorsInContent(source, resources, value => doc.context.lookup(value), new Set(['/Spot1']));
    assert.equal(result.text, source);
    assert.deepEqual([...result.unconverted], ['/Spot1']);
  }
});

test('convertSpotColorsToCmyk preserves unselected foil content and its resource', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  const tint = { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 };
  page.node.set(PDFName.of('Resources'), doc.context.obj({ ColorSpace: {
    Ink: ['Separation', 'PANTONE 877 U', 'DeviceCMYK', tint],
    Foil: ['Separation', 'SILVER FOIL', 'DeviceCMYK', tint]
  } }));
  const foilContent = '/Foil cs 1 scn 50 50 10 10 re f';
  const content = doc.context.register(doc.context.flateStream(`/Ink cs 1 scn 0 0 10 10 re f ${foilContent}`));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = convertSpotColorsToCmyk(doc, new Set(['/PANTONE#20877#20U']));
  assert.deepEqual([...converted], ['/PANTONE#20877#20U']);
  assert.equal(unconverted.size, 0);
  assert.ok(streamText(doc, content).endsWith(foilContent));
  const spaces = page.node.Resources().lookup(PDFName.of('ColorSpace'));
  assert.equal(spaces.get(PDFName.of('Ink')), undefined);
  assert.ok(spaces.get(PDFName.of('Foil')) instanceof PDFArray);
});

test('convertSpotColorsInContent refuses a partial DeviceN selection without changing either ink', async () => {
  const doc = await PDFDocument.create();
  const tint = doc.context.register(doc.context.flateStream('{ pop 0 0 0 }', {
    FunctionType: 4, Domain: [0, 1, 0, 1], Range: [0, 1, 0, 1, 0, 1, 0, 1]
  }));
  const resources = doc.context.obj({ ColorSpace: {
    Mixed: ['DeviceN', ['Spot1', 'SILVER FOIL'], 'DeviceCMYK', tint]
  } });
  const source = '/Mixed cs 1 0.5 scn 0 0 10 10 re f';
  const result = convertSpotColorsInContent(source, resources, value => doc.context.lookup(value), new Set(['/Spot1']));
  assert.equal(result.text, source);
  assert.equal(result.converted.size, 0);
  assert.deepEqual([...result.unconverted], ['/Spot1']);
  const allSelected = convertSpotColorsInContent(source, resources, value => doc.context.lookup(value), new Set(['/Spot1', '/SILVER#20FOIL']));
  assert.equal(allSelected.text, '/Mixed cs 1 0 0 0 k 0 0 10 10 re f');
  assert.equal(allSelected.converted.size, 2);
});

test('convertSpotColorsInContent restores colorspace state across q/Q', () => {
  return PDFDocument.create().then(doc => {
    const resources = doc.context.obj({ ColorSpace: {
      Spot1: ['Separation', 'Spot1', 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 }]
    } });
    const lookup = value => doc.context.lookup(value);
    // Inside q/Q the fill space switches to DeviceGray; after Q it must revert to Spot1.
    const source = '/Spot1 cs q 1 g 0 0 5 5 re f Q 1 scn 0 0 10 10 re f';
    const result = convertSpotColorsInContent(source, resources, lookup, new Set(['/Spot1']));
    assert.equal(result.text, '/Spot1 cs q 1 g 0 0 5 5 re f Q 0 0 0 1 k 0 0 10 10 re f');
  });
});

test('convertSpotColorsToCmyk converts a spot across the page and a nested Form XObject, then removes the resource entry', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  const spotSpace = { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 };
  const formStream = doc.context.register(doc.context.flateStream('/Spot1 cs 1 scn 0 0 5 5 re f', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 5, 5],
    Resources: { ColorSpace: { Spot1: ['Separation', 'Spot1', 'DeviceCMYK', spotSpace] } }
  }));
  page.node.set(PDFName.of('Resources'), doc.context.obj({
    ColorSpace: { Spot1: ['Separation', 'Spot1', 'DeviceCMYK', spotSpace] },
    XObject: { Fm0: formStream }
  }));
  const pageContent = doc.context.register(doc.context.flateStream('/Spot1 cs 1 scn 0 0 10 10 re f /Fm0 Do'));
  page.node.set(PDFName.of('Contents'), pageContent);

  const { converted, unconverted } = convertSpotColorsToCmyk(doc, new Set(['/Spot1']));
  assert.deepEqual([...converted], ['/Spot1']);
  assert.equal(unconverted.size, 0);

  // The cs selector itself is stripped too, not just the scn - otherwise it
  // would dangle, pointing at the Separation resource entry deleted below.
  assert.equal(streamText(doc, pageContent), ' 0 0 0 1 k 0 0 10 10 re f /Fm0 Do');
  assert.equal(streamText(doc, formStream), ' 0 0 0 1 k 0 0 5 5 re f');

  // Resource cleanup: the now-unused Separation entry is gone from both scopes.
  assert.equal(page.node.Resources().lookup(PDFName.of('ColorSpace')).get(PDFName.of('Spot1')), undefined);
  const formResources = doc.context.lookup(doc.context.lookup(formStream).dict.get(PDFName.of('Resources')));
  assert.equal(formResources.get(PDFName.of('Spot1')), undefined);
});

test('convertSpotColorsToCmyk leaves an unconvertible spot in place everywhere and does not remove its resource entry', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  page.node.set(PDFName.of('Resources'), doc.context.obj({
    ColorSpace: { Spot1: ['Separation', 'Spot1', 'Lab', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0], C1: [100, 0, 0], N: 1 }] }
  }));
  const pageContent = doc.context.register(doc.context.flateStream('/Spot1 cs 1 scn 0 0 10 10 re f'));
  page.node.set(PDFName.of('Contents'), pageContent);

  const { converted, unconverted } = convertSpotColorsToCmyk(doc, new Set(['/Spot1']));
  assert.equal(converted.size, 0);
  assert.deepEqual([...unconverted], ['/Spot1']);
  assert.equal(streamText(doc, pageContent), '/Spot1 cs 1 scn 0 0 10 10 re f');
  assert.ok(page.node.Resources().lookup(PDFName.of('ColorSpace')).get(PDFName.of('Spot1')) instanceof PDFArray);
});

test('a spot stays unchanged everywhere when any occurrence cannot be converted', async () => {
  const doc = await PDFDocument.create();
  const contents = [];
  for (const alternate of ['DeviceCMYK', 'Lab']) {
    const page = doc.addPage([100, 100]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ ColorSpace: {
      Spot1: ['Separation', 'Spot1', alternate, { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 }]
    } }));
    const content = doc.context.register(doc.context.flateStream('/Spot1 cs 1 scn 0 0 10 10 re f'));
    page.node.set(PDFName.of('Contents'), content); contents.push(content);
  }
  const result = convertSpotColorsToCmyk(doc, new Set(['/Spot1']));
  assert.equal(result.converted.size, 0);
  assert.deepEqual([...result.unconverted], ['/Spot1']);
  for (const content of contents) assert.equal(streamText(doc, content), '/Spot1 cs 1 scn 0 0 10 10 re f');
  for (const page of doc.getPages()) assert.ok(page.node.Resources().lookup(PDFName.of('ColorSpace')).has(PDFName.of('Spot1')));
});

test('device color operators replace the previously selected spot color space', async () => {
  const doc = await PDFDocument.create();
  const resources = doc.context.obj({ ColorSpace: {
    Spot1: ['Separation', 'Spot1', 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 }]
  } });
  const tail = '0 0 0 1 k 0.2 0.3 0.4 0.5 scn 20 20 10 10 re f';
  const result = convertSpotColorsInContent('/Spot1 cs 1 scn 0 0 10 10 re f ' + tail, resources, value => doc.context.lookup(value), new Set(['/Spot1']));
  assert.ok(result.text.endsWith(tail));
  assert.deepEqual([...result.converted], ['/Spot1']);
  assert.equal(result.unconverted.size, 0);
});

test('split page streams and Forms retain inherited spot spaces and graphics state', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  const form = doc.context.register(doc.context.flateStream('0.5 scn 0 0 10 10 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100] }));
  page.node.set(PDFName.of('Resources'), doc.context.obj({
    ColorSpace: { Spot1: ['Separation', 'Spot1', 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 }] },
    XObject: { Form: form }
  }));
  page.node.set(PDFName.of('Contents'), doc.context.obj([
    doc.context.register(doc.context.flateStream('/Spot1 cs q 1 scn 0 0 10 10 re f')),
    doc.context.register(doc.context.flateStream('Q /Form Do'))
  ]));
  doc.addPage([100, 100]); // A genuinely blank page has no content stream.
  const result = convertSpotColorsToCmyk(doc, new Set(['/Spot1']));
  assert.deepEqual([...result.converted], ['/Spot1']);
  assert.equal(result.unconverted.size, 0);
  assert.ok(streamText(doc, form).includes('0 0 0 0.5 k'));
  assert.ok(streamText(doc, page.node.get(PDFName.of('Contents'))).includes('0 0 0 1 k'));
});

test('rendering intents from ri and ExtGState follow q/Q when transforming ICC colors', async () => {
  const doc = await PDFDocument.create();
  const resources = doc.context.obj({
    ColorSpace: { Spot1: ['Separation', 'Spot1', ['Lab', { WhitePoint: [0.9642, 1, 0.8249] }], { FunctionType: 2, Domain: [0, 1], C0: [100, 0, 0], C1: [50, 0, 0], N: 1 }] },
    ExtGState: { Absolute: { RI: 'AbsoluteColorimetric' } }
  });
  const intents = [];
  const result = convertSpotColorsInContent('/Perceptual ri /Spot1 cs 1 scn q /Absolute gs 0.5 scn Q 0.25 scn', resources, value => doc.context.lookup(value), new Set(['/Spot1']), {}, {
    convert(space, components, lookup, intent) { intents.push(intent); return [0, 0, 0, components[0] / 100]; },
    colorSpace: () => '/Process'
  });
  assert.deepEqual(intents, ['Perceptual', 'AbsoluteColorimetric', 'Perceptual']);
  assert.ok(result.text.includes('/Process cs 0 0 0 0.5 scn'));
  assert.equal(result.unconverted.size, 0);
});

test('a default-tint paint does not become the default device color after resource pruning', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ ColorSpace: {
    Spot1: ['Separation', 'Spot1', 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 }]
  } }));
  const source = '/Spot1 cs q 1 scn 0 0 10 10 re f Q 20 20 10 10 re f';
  const content = doc.context.register(doc.context.flateStream(source));
  page.node.set(PDFName.of('Contents'), content);
  const result = convertSpotColorsToCmyk(doc, new Set(['/Spot1']));
  assert.equal(result.converted.size, 0);
  assert.equal(streamText(doc, content), source);
  assert.match(result.reasons.get('/Spot1'), /Implicit default/);
});

test('spots used inside images, shadings, or tiling patterns are retained throughout the document', async () => {
  for (const kind of ['image', 'indexed-image', 'inline-image', 'shading', 'pattern']) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const spot = doc.context.obj(['Separation', 'Spot1', 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 }]);
    const resources = doc.context.obj({ ColorSpace: { Spot1: spot } });
    page.node.set(PDFName.of('Resources'), resources);
    let tail;
    if (kind === 'inline-image') {
      tail = 'BI /W 1 /H 1 /CS /Spot1 /BPC 8 ID \xFF EI ';
    } else if (kind === 'image' || kind === 'indexed-image') {
      const imageSpace = kind === 'indexed-image' ? ['Indexed', 'Spot1', 0, 'x'] : 'Spot1';
      const image = doc.context.register(doc.context.flateStream(Uint8Array.of(255), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: imageSpace }));
      resources.set(PDFName.of('XObject'), doc.context.obj({ Image: image })); tail = '/Image Do';
    } else if (kind === 'shading') {
      resources.set(PDFName.of('Shading'), doc.context.obj({ Shade: { ShadingType: 2, ColorSpace: spot } })); tail = '/Shade sh';
    } else {
      const pattern = doc.context.register(doc.context.flateStream('/Spot1 cs 0.5 scn 0 0 10 10 re f', { PatternType: 1, PaintType: 1, BBox: [0, 0, 10, 10], XStep: 10, YStep: 10, Resources: { ColorSpace: { Spot1: spot } } }));
      resources.set(PDFName.of('Pattern'), doc.context.obj({ Pattern: pattern })); tail = '/Pattern cs /Pattern scn 20 20 10 10 re f';
    }
    const source = '/Spot1 cs 1 scn 0 0 10 10 re f ' + tail;
    const content = doc.context.register(doc.context.flateStream(source)); page.node.set(PDFName.of('Contents'), content);
    const result = convertSpotColorsToCmyk(doc, new Set(['/Spot1']));
    assert.equal(result.converted.size, 0, kind);
    assert.equal(streamText(doc, content), source, kind);
    assert.ok(resources.lookup(PDFName.of('ColorSpace')).has(PDFName.of('Spot1')), kind);
  }
});


test('unsupported appearance, Type3, and soft-mask content cannot leave partially converted plates', async () => {
  for (const kind of ['appearance', 'type3', 'soft-mask']) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const resources = doc.context.obj({ ColorSpace: {
      Spot1: ['Separation', 'Spot1', 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 }]
    } });
    page.node.set(PDFName.of('Resources'), resources);
    const source = '/Spot1 cs 1 scn 0 0 10 10 re f';
    const content = doc.context.register(doc.context.flateStream(source));
    page.node.set(PDFName.of('Contents'), content);
    const form = doc.context.register(doc.context.flateStream(source, { Subtype: 'Form', BBox: [0, 0, 10, 10], Resources: resources }));
    if (kind === 'appearance') page.node.set(PDFName.of('Annots'), doc.context.obj([{ Subtype: 'Stamp', AP: { N: form } }]));
    if (kind === 'type3') resources.set(PDFName.of('Font'), doc.context.obj({ Glyph: { Subtype: 'Type3', CharProcs: { A: form } } }));
    if (kind === 'soft-mask') resources.set(PDFName.of('ExtGState'), doc.context.obj({ Mask: { SMask: { G: form } } }));
    const result = convertSpotColorsToCmyk(doc, new Set(['/Spot1']));
    assert.equal(result.converted.size, 0, kind);
    assert.match(result.reasons.get('/Spot1'), /source-file spot conversion/);
    assert.equal(streamText(doc, content), source, kind);
    assert.ok(resources.lookup(PDFName.of('ColorSpace')).has(PDFName.of('Spot1')), kind);
  }
});

test('spot conversion preserves literal font character bytes outside ASCII', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ ColorSpace: {
    Spot1: ['Separation', 'Spot1', 'DeviceCMYK', { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 }]
  } }));
  const prefix = 'BT /Font 12 Tf (\x80\x81\x8D\x9C\xFF) Tj ET ';
  const source = prefix + '/Spot1 cs 1 scn 0 0 10 10 re f';
  const content = doc.context.register(doc.context.flateStream(Uint8Array.from(source, character => character.charCodeAt(0))));
  page.node.set(PDFName.of('Contents'), content);
  assert.equal(convertSpotColorsToCmyk(doc, new Set(['/Spot1'])).converted.size, 1);
  const result = decodePDFRawStream(doc.context.lookup(content)).decode();
  assert.deepEqual(result.subarray(0, prefix.length), Uint8Array.from(prefix, character => character.charCodeAt(0)));
});
