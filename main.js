function openModal() {
  document.getElementById('modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  document.body.style.overflow = '';
}

function closeOnOverlay(e) {
  if (e.target === document.getElementById('modal')) closeModal();
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeModal();
});

// Phone: auto-format as (XXX) XXX-XXXX while typing
const phoneInput = document.getElementById('field-phone');
phoneInput.addEventListener('input', function () {
  const digits = this.value.replace(/\D/g, '').slice(0, 10);
  let formatted = digits;
  if (digits.length >= 7) {
    formatted = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  } else if (digits.length >= 4) {
    formatted = `(${digits.slice(0,3)}) ${digits.slice(3)}`;
  } else if (digits.length >= 1) {
    formatted = `(${digits}`;
  }
  this.value = formatted;
});

function validateEmail(val) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
}

function validatePhone(val) {
  return val.replace(/\D/g, '').length === 10;
}

function setError(inputEl, errorEl, show) {
  if (show) {
    inputEl.classList.add('invalid');
    errorEl.classList.add('visible');
  } else {
    inputEl.classList.remove('invalid');
    errorEl.classList.remove('visible');
  }
}

document.getElementById('contact-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const form = e.target;

  const emailVal = document.getElementById('field-email').value;
  const phoneVal = document.getElementById('field-phone').value;

  const emailOk = validateEmail(emailVal);
  const phoneOk = validatePhone(phoneVal);

  setError(
    document.getElementById('field-email'),
    document.getElementById('err-email'),
    !emailOk
  );
  setError(
    document.querySelector('.phone-input'),
    document.getElementById('err-phone'),
    !phoneOk
  );

  if (!emailOk || !phoneOk) return;

  const data = {
    name: document.getElementById('field-name').value,
    email: emailVal,
    phone: '+1 ' + phoneVal,
  };

  try {
    await fetch('https://formspree.io/f/mzdwgrja', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data),
    });
  } finally {
    form.style.display = 'none';
    document.getElementById('modal-success').style.display = 'block';
  }
});
