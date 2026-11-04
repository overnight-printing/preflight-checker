# ICC test fixtures

`lab-d50.icc` and `srgb.icc` were generated with native LittleCMS 2.17 using
`cmsCreateLab4Profile(NULL)`, `cmsCreate_sRGBProfile()`, and
`cmsSaveProfileToMem()`. Both retain the engine's embedded copyright statement:
"No copyright, use freely". No customer profile data is included.

`icc-native-reference.json` records native LittleCMS 2.17 float transforms from
these profiles into the unchanged bundled SWOP2006_Coated3v2 profile, using
relative colorimetric intent and black point compensation. Native CMYK float
percentages are divided by 100 for PDF component values. The first Lab sample
is the tint-transform value from the customer file; it contains no artwork.

These fixed native results independently check the browser WASM binding's
Lab ranges, negative a/b values, component ordering, and percent normalization.
