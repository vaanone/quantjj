(() => {
  const s = document.querySelectorAll('[role=slider]')[0];
  if (!s) return 'no slider';
  s.focus();
  // Press Home to go to min
  s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, code: 'Home' }));
  const inputs = document.querySelectorAll('input[type=range]');
  return JSON.stringify({
    inputs: inputs.length,
    vals: Array.from(inputs).map(i => i.value),
    aria: s.getAttribute('aria-valuenow'),
  });
})()
