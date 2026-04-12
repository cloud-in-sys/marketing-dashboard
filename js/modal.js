// ===== Promise-based custom modal =====
export function showModal({title, body, html = false, wide = false, input = false, defaultValue = '', placeholder = '', okText = 'OK', cancelText = '\u30ad\u30e3\u30f3\u30bb\u30eb', danger = false}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    const modalEl = overlay.querySelector('.modal');
    if (modalEl) modalEl.classList.toggle('wide', !!wide);
    document.getElementById('modal-title').textContent = title || '';
    const bodyEl = document.getElementById('modal-body');
    if (html) bodyEl.innerHTML = body || '';
    else bodyEl.textContent = body || '';
    const inputEl = document.getElementById('modal-input');
    inputEl.classList.toggle('hidden', !input);
    inputEl.value = defaultValue;
    inputEl.placeholder = placeholder;
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;
    cancelBtn.style.display = cancelText ? '' : 'none';
    okBtn.classList.toggle('danger', !!danger);
    overlay.classList.remove('hidden');
    if (input) setTimeout(() => inputEl.focus(), 50);
    const cleanup = () => {
      overlay.classList.add('hidden');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      overlay.onclick = null;
      inputEl.onkeydown = null;
    };
    const confirm = () => { const v = input ? inputEl.value : true; cleanup(); resolve(v); };
    const cancel = () => { cleanup(); resolve(null); };
    okBtn.onclick = confirm;
    cancelBtn.onclick = cancel;
    overlay.onclick = e => { if (e.target === overlay) cancel(); };
    inputEl.onkeydown = e => {
      if (e.key === 'Enter') confirm();
      else if (e.key === 'Escape') cancel();
    };
  });
}
