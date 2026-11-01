(() => {
  const c = document.querySelector('canvas');
  if (!c) return 'no canvas';
  const ctx = c.getContext('2d');
  const imgData = ctx.getImageData(0, 0, c.width, c.height);
  let nonBg = 0;
  for (let i = 0; i < imgData.data.length; i += 4) {
    const r = imgData.data[i];
    const g = imgData.data[i + 1];
    const b = imgData.data[i + 2];
    if (Math.abs(r - 14) > 5 || Math.abs(g - 15) > 5 || Math.abs(b - 20) > 5) nonBg++;
  }
  const total = imgData.data.length / 4;
  return JSON.stringify({ total, nonBg, ratio: (nonBg / total).toFixed(4) });
})()
