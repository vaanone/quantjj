(() => {
  const canvas = document.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  // The volume histogram used to occupy bottom ~20% with semi-transparent green/red bars.
  // Sample the bottom 20% strip (excluding the time-axis labels at the very bottom).
  const stripTop = Math.floor(h * 0.80);
  const stripBottom = Math.floor(h * 0.94);
  const stripData = ctx.getImageData(0, stripTop, w, stripBottom - stripTop);
  let volUpPixels = 0; // rgba green-ish (38, 166, 154, ~89)
  let volDownPixels = 0; // rgba red-ish (239, 83, 80, ~89)
  let nonBg = 0;
  for (let i = 0; i < stripData.data.length; i += 4) {
    const r = stripData.data[i];
    const g = stripData.data[i + 1];
    const b = stripData.data[i + 2];
    const a = stripData.data[i + 3];
    if (Math.abs(r - 14) > 5 || Math.abs(g - 15) > 5 || Math.abs(b - 20) > 5) nonBg++;
    // Semi-transparent green: r ~14-50, g ~80-130, b ~70-100
    if (g > 80 && g < 140 && r < 80 && b < 110 && a > 30 && a < 200) volUpPixels++;
    // Semi-transparent red: r ~120-180, g ~40-80, b ~40-80
    if (r > 120 && r < 200 && g < 90 && b < 90 && a > 30 && a < 200) volDownPixels++;
  }
  return JSON.stringify({
    stripH: stripBottom - stripTop,
    nonBg,
    volUpPixels,
    volDownPixels,
    totalVolPixels: volUpPixels + volDownPixels,
  });
})()
