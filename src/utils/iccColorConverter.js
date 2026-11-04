import { PDFArray, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { cmsFLAGS_BLACKPOINTCOMPENSATION } from 'lcms-wasm';
import { getIccProfileInfo, getSpotAlternateInfo } from './iccProfiles.js';

const INTENTS = { Perceptual: 0, RelativeColorimetric: 1, Saturation: 2, AbsoluteColorimetric: 3 };

export function createIccColorConverter(engine, outputBytes) {
  if (getIccProfileInfo(outputBytes).colorSpace !== 'CMYK') throw new Error('Choose a CMYK press/paper ICC profile.');
  const profiles = new Set();
  const sources = new Map(), transforms = new Map();
  const close = () => {
    for (const transform of transforms.values()) engine.cmsDeleteTransform(transform);
    for (const profile of profiles) engine.cmsCloseProfile(profile);
    transforms.clear(); profiles.clear(); sources.clear();
  };
  const openProfile = bytes => {
    const profile = engine.cmsOpenProfileFromMem(bytes, bytes.length);
    if (!profile) throw new Error('The ICC profile could not be read.');
    profiles.add(profile);
    return profile;
  };
  let output, lab;
  const getTransform = (input, intent) => {
    const key = `${input}:${intent}`;
    if (!transforms.has(key)) {
      const transform = engine.cmsCreateTransform(
        input, engine.cmsFormatterForColorspaceOfProfile(input, 4, true),
        output, engine.cmsFormatterForColorspaceOfProfile(output, 4, true),
        intent, intent === 1 ? cmsFLAGS_BLACKPOINTCOMPENSATION : 0
      );
      if (!transform) throw new Error('This profile cannot convert Lab to CMYK. Choose a press/paper output ICC profile.');
      transforms.set(key, transform);
    }
    return transforms.get(key);
  };
  try {
    output = openProfile(outputBytes);
    lab = engine.cmsCreateLab4Profile();
    if (!lab) throw new Error('Unable to initialize the Lab color profile.');
    profiles.add(lab);
    getTransform(lab, 1);
  } catch (error) { close(); throw error; }

  return {
    close,
    convert(space, values, lookup, renderingIntent = 'RelativeColorimetric') {
      if (!profiles.has(output)) throw new Error('The ICC converter is closed.');
      const capability = getSpotAlternateInfo(space, lookup);
      if (capability.reason) throw new Error(capability.reason);
      if (!(space instanceof PDFArray)) throw new Error('A profiled source color space is required.');
      let source = sources.get(space);
      if (!source) {
        if (space.get(0) === PDFName.of('ICCBased')) {
          const stream = lookup(space.get(1));
          if (!(stream instanceof PDFRawStream)) throw new Error('Missing source ICC profile.');
          const bytes = decodePDFRawStream(stream).decode();
          source = { profile: openProfile(bytes), ...getIccProfileInfo(bytes) };
        } else {
          const parameters = lookup(space.get(1));
          if (!(parameters instanceof PDFDict)) throw new Error('Missing Lab parameters.');
          const xyz = lookup(parameters.get(PDFName.of('WhitePoint'))).asArray().map(value => lookup(value).asNumber());
          const sum = xyz.reduce((total, value) => total + value, 0);
          const profile = engine.cmsCreateLab4Profile([xyz[0] / sum, xyz[1] / sum, xyz[1]]);
          if (!profile) throw new Error('Unable to initialize the Lab white point.');
          profiles.add(profile);
          source = { profile, colorSpace: 'Lab', channels: 3 };
        }
        sources.set(space, source);
      }
      if (values.length !== source.channels || values.some(value => !Number.isFinite(value))) throw new Error('Invalid source color components.');
      const bounds = source.colorSpace === 'Lab' ? [[0, 100], [-128, 127], [-128, 127]] : values.map(() => [0, 1]);
      if (values.some((value, index) => value < bounds[index][0] || value > bounds[index][1])) throw new Error('Source color components are outside their profile range.');
      const intent = INTENTS[renderingIntent];
      if (intent === undefined) throw new Error('Unsupported PDF rendering intent.');
      const input = source.colorSpace === 'CMYK' ? values.map(value => value * 100) : values;
      const result = Array.from(engine.cmsDoTransform(getTransform(source.profile, intent), new Float32Array(input), 1), value => value / 100);
      if (result.length !== 4 || result.some(value => !Number.isFinite(value) || value < -0.00001 || value > 1.00001)) throw new Error('The ICC transform produced invalid CMYK components.');
      return result.map(value => Math.min(1, Math.max(0, value)));
    }
  };
}
