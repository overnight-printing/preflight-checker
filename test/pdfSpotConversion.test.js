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

  assert.equal(streamText(doc, pageContent), '/Spot1 cs 0 0 0 1 k 0 0 10 10 re f /Fm0 Do');
  assert.equal(streamText(doc, formStream), '/Spot1 cs 0 0 0 1 k 0 0 5 5 re f');

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
