const Jimp = require('jimp');

async function fix() {
  const image = await Jimp.read('public/favicon.png');
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
    const r = this.bitmap.data[idx + 0];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    if (r > 240 && g > 240 && b > 240) {
      this.bitmap.data[idx + 3] = 0; // alpha
    }
  });
  await image.writeAsync('public/favicon.png');
  console.log('Done');
}

fix();
