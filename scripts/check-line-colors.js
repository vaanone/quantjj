(() => {
  const canvas = document.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  let greenPixels = 0;   // #22c55e = (34, 197, 94)
  let redPixels = 0;     // #ef4444 = (239, 68, 68)
  let amberPixels = 0;   // #f59e0b = (245, 158, 11) — old resistance color
  let oldGreenPixels = 0; // #10b981 = (16, 185, 129) — old support color
  for (let i = 0; i < imgData.data.length; i += 4) {
    const r = imgData.data[i];
    const g = imgData.data[i + 1];
    const b = imgData.data[i + 2];
    // New resistance: green #22c55e (34, 197, 94)
    if (Math.abs(r - 34) < 20 && Math.abs(g - 197) < 20 && Math.abs(b - 94) < 20) greenPixels++;
    // New support: red #ef4444 (239, 68, 68)
    if (Math.abs(r - 239) < 20 && Math.abs(g - 68) < 20 && Math.abs(b - 68) < 20) redPixels++;
    // Old resistance: amber #f59e0b (245, 158, 11)
    if (Math.abs(r - 245) < 20 && Math.abs(g - 158) < 20 && Math.abs(b - 11) < 20) amberPixels++;
    // Old support: emerald #10b981 (16, 185, 129)
    if (Math.abs(r - 16) < 20 && Math.abs(g - 185) < 20 && Math.abs(b - 129) < 20) oldGreenPixels++;
  }
  return JSON.stringify({
    greenPixels,
    redPixels,
    amberPixels,
    oldGreenPixels,
  });
})()
