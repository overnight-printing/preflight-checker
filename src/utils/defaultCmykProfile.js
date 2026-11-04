let profilePromise;

export function loadDefaultCmykProfile() {
  if (!profilePromise) {
    profilePromise = fetch(`${import.meta.env.BASE_URL}profiles/SWOP2006_Coated3v2.icc`).then(async response => {
      if (!response.ok) throw new Error('The standard SWOP CMYK profile could not be loaded.');
      return { name: 'SWOP2006_Coated3v2.icc', bytes: new Uint8Array(await response.arrayBuffer()) };
    }).catch(error => { profilePromise = undefined; throw error; });
  }
  return profilePromise;
}
