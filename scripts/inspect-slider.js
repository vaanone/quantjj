(() => {
  const s = document.querySelectorAll('[role=slider]')[0];
  if (!s) return 'no slider';
  const r = s.getBoundingClientRect();
  return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height, aria: s.getAttribute('aria-valuenow') });
})()
