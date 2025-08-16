(function () {
  const $ = (sel) => document.querySelector(sel);
  // Config
  const apiBaseEl = $('#apiBase');
  const merchantUrlEl = $('#merchantUrl');
  const terminalIdEl = $('#terminalId');
  const orderIdEl = $('#orderId');
  // Money
  const amountEl = $('#amount');
  const currencyEl = $('#currency');
  // Card
  const panEl = $('#pan');
  const expEl = $('#exp');
  const cvvEl = $('#cvv');
  // Customer
  const firstName = $('#firstName');
  const lastName = $('#lastName');
  const email = $('#email');
  const phone = $('#phone');
  // Billing
  const billLine1 = $('#billLine1');
  const billLine2 = $('#billLine2');
  const billCity = $('#billCity');
  const billState = $('#billState');
  const billZip = $('#billZip');
  const billCountry = $('#billCountry');
  // Shipping
  const shipSame = $('#shipSame');
  const shipLine1 = $('#shipLine1');
  const shipLine2 = $('#shipLine2');
  const shipCity = $('#shipCity');
  const shipState = $('#shipState');
  const shipZip = $('#shipZip');
  const shipCountry = $('#shipCountry');

  const logEl = $('#log');
  const saleStatus = $('#saleStatus');
  const btnSale = $('#btnSale');
  const btnTxn = $('#btnTxn');

  let flowType = null; // Puede ser "sale" o "auth"


  // Defaults para tu deploy
  if (apiBaseEl && !apiBaseEl.value) apiBaseEl.value = "https://smartpaypasarelas.onrender.com";
  if (merchantUrlEl && !merchantUrlEl.value) merchantUrlEl.value = "https://smartpaypasarelas.onrender.com/api/spi/3ds/return";

  // Estado en memoria
  let lastTxnId = null;
  let lastAmount = null;

  function log(o) {
    const s = (typeof o === 'string') ? o : JSON.stringify(o, null, 2);
    logEl.textContent = (logEl.textContent + '\n' + s).slice(-60000);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function normalizeExpiry(input) {
    if (!input) return "";
    const d = String(input).replace(/\D/g, '');
    if (d.length === 4) {
      const mm = d.slice(0, 2);
      const yy = d.slice(2);
      const mNum = parseInt(mm, 10);
      if (mNum >= 1 && mNum <= 12) return yy + mm; // MMYY -> YYMM
      return d; // ya es YYMM
    }
    if (d.length === 6) return d.slice(2); // 20MMYY -> MMYY => YYMM
    return d;
  }

  function buildAddress(prefix) {
    const obj = {
      FirstName: firstName.value.trim() || undefined,
      LastName: lastName.value.trim() || undefined,
      Line1: prefix === 'bill' ? billLine1.value.trim() : shipLine1.value.trim(),
      Line2: prefix === 'bill' ? billLine2.value.trim() : shipLine2.value.trim(),
      City: prefix === 'bill' ? billCity.value.trim() : shipCity.value.trim(),
      State: prefix === 'bill' ? billState.value.trim() : shipState.value.trim(),
      PostalCode: prefix === 'bill' ? billZip.value.trim() : shipZip.value.trim(),
      CountryCode: (prefix === 'bill' ? billCountry.value.trim() : shipCountry.value.trim() || billCountry.value.trim() || 'PA').toUpperCase(),
      EmailAddress: email.value.trim() || undefined,
      PhoneNumber: phone.value.trim() || undefined
    };
    return obj;
  }

  function prettyPayment(r) {
    if (!r || typeof r !== 'object') return 'Respuesta vacía';
    const iso = r.IsoResponseCode || r.ResponseCode || '';
    const msg = r.ResponseMessage || '';
    const approved = r.Approved ?? (iso === '00');
    const id = r.TransactionIdentifier || '';
    const amount = r.TotalAmount != null ? r.TotalAmount : '';
    const eci = r.RiskManagement?.ThreeDSecure?.Eci;
    const authStat = r.RiskManagement?.ThreeDSecure?.AuthenticationStatus;

    return [
      `Estado: ${approved ? 'APROBADO ✅' : 'PROCESADO'}`,
      `IsoResponseCode: ${iso} ${msg ? `(${msg})` : ''}`,
      eci ? `ECI: ${eci}` : null,
      authStat ? `3DS Status: ${authStat}` : null,
      `Monto: ${amount}  Moneda: ${r.CurrencyCode || ''}`,
      `TxnId: ${id}`
    ].filter(Boolean).join('\n');
  }

  async function callSale() {
    const apiBase = apiBaseEl.value.trim();
    if (!apiBase) return alert('Configura API_BASE');
    const merchantUrl = merchantUrlEl.value.trim();
    if (!merchantUrl) return alert('Configura MerchantResponseUrl');
    const billing = buildAddress('bill');
    let shipping = undefined;
    let addressMatch = true;
    if (!shipSame.checked) {
      addressMatch = false;
      shipping = buildAddress('ship');
    }
    if (!panEl.value.trim()) return alert("Falta el número de tarjeta");
    if (!expEl.value.trim() || expEl.value.length < 4) return alert("Fecha de expiración inválida");
    if (!cvvEl.value.trim() || cvvEl.value.length < 3) return alert("CVV inválido");
    const body = {
      TotalAmount: Number(amountEl.value || '0'),
      CurrencyCode: currencyEl.value,      // ya seleccionas "840"/"590"
      ThreeDSecure: true,
      AddressVerification: true,
      TerminalId: terminalIdEl.value || undefined,
      OrderIdentifier: orderIdEl.value || undefined,
      Source: {
        CardPan: panEl.value.trim(),
        CardExpiration: normalizeExpiry(expEl.value),
        CardCvv: cvvEl.value.trim(),
        CardholderName: [billing.FirstName || '', billing.LastName || ''].join(' ').trim() || undefined
      },
      BillingAddress: billing,
      ShippingAddress: shipping,
      AddressMatch: addressMatch,
      ExtendedData: {
        MerchantResponseUrl: merchantUrl,
        BrowserInfo: {
          UserAgent: navigator.userAgent,
          IP: '',
          JavascriptEnabled: true,
          Language: navigator.language,
          ScreenHeight: String(window.screen.height),
          ScreenWidth: String(window.screen.width),
          TimeZone: String(-new Date().getTimezoneOffset() / 60),
          ColorDepth: String(window.screen.colorDepth)
        }
      }
    };
    const url = apiBase.replace(/\/+$/, '') + '/api/spi/sale';
    log('Payload que se enviará a /api/spi/sale:');
    log(body);
    log(`> POST ${url}`);
    saleStatus.textContent = 'llamando…';
    btnSale.disabled = true;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const ctype = (r.headers.get('content-type') || '').toLowerCase();
      log(`HTTP ${r.status}  — content-type: ${ctype || '(desconocido)'}`);

      const txt = await r.text();

      // Si es HTML (form auto-post al ACS), ábrelo
      if (ctype.includes('text/html') || /^<!doctype|<html/i.test(txt)) {
        log('HTML recibido (posible ACS). Abriendo ventana/popup…');
        openHtmlPopup(txt);
        return;
      }
      // Intentar JSON
      let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
      log(data);
      // 1) HTML embebido en JSON
      if (data && typeof data.RedirectHtml === 'string' && /<html|<form/i.test(data.RedirectHtml)) {
        openHtmlPopup(data.RedirectHtml); return;
      }
      // 2) URL directa
      if (data && data.RedirectUrl) { open(data.RedirectUrl, 'ptz3ds', 'width=430,height=700'); return; }
      // 3) ACS + PaReq
      const acs = data?.AcsUrl || data?.ACSUrl || data?.ThreeDS?.AcsUrl || data?.ThreeDSecure?.AcsUrl;
      const pareq = data?.PaReq || data?.PAReq || data?.ThreeDS?.PaReq || data?.ThreeDSecure?.PaReq || data?.Payload;
      const md = data?.MD || data?.Md || data?.ThreeDS?.MD || data?.ThreeDSecure?.MD;
      if (acs) {
        const html = buildAutoPostHtml(acs, { PaReq: pareq || '', TermUrl: merchantUrl, MD: md || '' });
        openHtmlPopup(html); return;
      }
      alert('No se encontró información de redirección 3DS en la respuesta. Revisa el backend/respuesta.');
    } catch (e) {
      console.error(e); log('Error en fetch: ' + (e.message || e.toString()));
    } finally {
      saleStatus.textContent = ''; btnSale.disabled = false;
    }
  }

  function buildAutoPostHtml(actionUrl, fields) {
    const inputs = Object.entries(fields).map(([k, v]) =>
      `<input type="hidden" name="${k}" value="${String(v || '').replace(/\"/g, '&quot;')}" />`).join('');
    return `<!doctype html><html><body onload="document.forms[0].submit()">
      <form method="POST" action="${actionUrl}">${inputs}</form>
      <p style="font:14px system-ui">Redirigiendo a ACS…</p>
    </body></html>`;
  }

  function openHtmlPopup(html) {
    const w = open('', 'ptz3ds', 'width=430,height=700');
    if (!w) { alert('El navegador bloqueó el popup. Permite ventanas emergentes y reintenta.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  window.addEventListener('message', async (ev) => {
    if (!ev || !ev.data || ev.data.type !== 'PTZ_3DS_DONE') return;
    const payload = ev.data.payload || {};
    log('Mensaje 3DS recibido'); log(payload);

    lastTxnId = payload.TransactionIdentifier || payload.Response?.TransactionIdentifier || null;
    lastAmount = payload.TotalAmount || payload.Response?.TotalAmount || null;

    if (!payload.SpiToken) {
      log('No llegó SpiToken; revisa el callback.');
      return;
    }

    // Guardamos para el capture posterior si fuera auth
    if (flowType === "auth") {
      log("Flujo AUTH detectado. No se hará Payment aún.");
      log(`TransactionIdentifier: ${lastTxnId}`);
      return;
    }

    const apiBase = apiBaseEl.value.trim();
    const payUrl = apiBase.replace(/\/+$/, '') + '/api/spi/payment';
    const autoComplete = flowType === "sale";
    log(`> POST ${payUrl}`);

    try {
      const r = await fetch(payUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          SpiToken: payload.SpiToken,
          TransactionIdentifier: lastTxnId,
          AutoComplete: autoComplete
        })
      });
      const txt = await r.text();
      let data;
      try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
      log('> /api/spi/payment respuesta:');
      log(data);
      log(prettyPayment(data));
    } catch (e) {
      log(e.message || e.toString());
    }
  });

  // Botón: consulta directa GET /transactions/{id}
  btnTxn.addEventListener('click', async () => {
    const apiBase = apiBaseEl.value.trim();
    const id = prompt('TransactionIdentifier a consultar', lastTxnId || '');
    if (!id) return;
    const url = apiBase.replace(/\/+$/, '') + '/api/transactions/' + encodeURIComponent(id);
    log(`> GET ${url}`);
    try {
      const r = await fetch(url);
      const txt = await r.text();
      let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
      log(data);
    } catch (e) { log(e.message || e.toString()); }
  });

  btnSale.addEventListener('click', () => {
    flowType = "sale";
    callSale();
  });

  async function doAuth() {
    const apiBase = apiBaseEl.value.trim().replace(/\/+$/, '');
    const threeDS = !document.querySelector('#authNo3ds')?.checked; // por defecto con 3DS
    // Normaliza el campo en app.js
    const expRaw = expEl.value.trim(); // "12/28"

    if (!panEl.value.trim()) return alert("Falta el número de tarjeta");
    if (!expEl.value.trim() || expEl.value.length < 4) return alert("Fecha de expiración inválida");
    if (!cvvEl.value.trim() || cvvEl.value.length < 3) return alert("CVV inválido");
    if (!/^\d{2}\/\d{2}$/.test(expRaw)) {
      return alert("Formato de expiración inválido. Usa MM/YY");
    }

    const [mm, yy] = expRaw.split('/');
    const expYYMM = yy + mm; // "2912"

    // Construye el payload igual que sale, solo cambia el endpoint
    const payload = {
      TotalAmount: Number(amountEl.value || '0'),
      CurrencyCode: currencyEl.value || '840',
      ThreeDSecure: threeDS,
      Source: {
        CardPan: panEl.value.trim(),
        CardExpiration: expYYMM, // YYMM (ej: "2812")
        CardCvv: cvvEl.value.trim(),
        CardholderName: [firstName.value, lastName.value].join(' ').trim()
      },
      OrderIdentifier: orderIdEl.value.trim() || 'TEST_AUTH',
      BillingAddress: buildAddress('bill'), 
      ExtendedData: {
        MerchantResponseUrl: merchantUrlEl.value.trim(),
        ThreeDSecure: {
          ChallengeWindowSize: 4,
          ChallengeIndicator: "01"
        },
        BrowserInfo: {
          UserAgent: navigator.userAgent,
          IP: '',
          JavascriptEnabled: true,
          Language: navigator.language,
          ScreenHeight: String(window.screen.height),
          ScreenWidth: String(window.screen.width),
          TimeZone: String(-new Date().getTimezoneOffset() / 60),
          ColorDepth: String(window.screen.colorDepth)
        }    // el mismo que ya usas para sale
      }
    };

    const url = `${apiBase}/api/spi/auth`;
    log(`> POST ${url}`);
    log('Payload a /api/spi/Auth => ' + JSON.stringify(payload));

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    log(data);

    // Tres posibilidades:
    // A) Auth con 3DS -> te devuelven HTML/redirect (ya lo manejas con popup) y luego Mensaje 3DS con SpiToken
    // B) Frictionless -> el mismo /api/spi/auth puede devolver Approved=true sin 3DS
    // C) Si /spi/auth devuelve objeto con SpiToken directamente, llama /api/spi/payment

    // Si viene SpiToken directo (sin necesidad de popup) completa con /payment:
    const spiToken = data?.SpiToken || data?.Response?.SpiToken;
    const txnId = data?.TransactionIdentifier || data?.Response?.TransactionIdentifier;
    lastAmount = data?.TotalAmount;

    if (spiToken) {
      lastTxnId = txnId || lastTxnId;
      await completeWithPayment(spiToken, txnId); // reutiliza tu función de /api/spi/payment
    } else {
      // Si era con 3DS y tu flujo ya abrió el popup, el callback /3ds/return te manda el token por postMessage,
      // y tu listener existente ya llama a /api/spi/payment automáticamente.
      // No hay que hacer nada aquí.
    }
  }

  // registra el listener del botón
  document.querySelector('#btnAuth3ds')?.addEventListener('click', () => {
    flowType = "auth";
    doAuth();
  });

  // Helper para cerrar con payment (si no lo tienes ya como función aislada)
  async function completeWithPayment(spiToken, txnId) {
    const apiBase = apiBaseEl.value.trim().replace(/\/+$/, '');
    const url = `${apiBase}/api/spi/payment`;
    const body = { SpiToken: spiToken, TransactionIdentifier: txnId || undefined };
    log('> POST ' + url);
    log('Body => ' + JSON.stringify(body));
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const txt = await r.text(); let resp; try { resp = JSON.parse(txt); } catch { resp = { raw: txt }; }
    log(resp);
    lastTxnId = resp?.TransactionIdentifier || lastTxnId;
    log(prettyPayment(resp));
  }


  async function doCapture() {
    const apiBase = apiBaseEl.value.trim();
    const url = apiBase.replace(/\/+$/, '') + `/api/capture`;

    const transactionIdentifier = lastTxnId; // Ya lo tienes cargado
    const amount = lastAmount; // Debes tener este dato disponible

    if (!transactionIdentifier || !amount) {
      log("Faltan datos para capturar la transacción.");
      return;
    }

    const body = {
      TransactionIdentifier: transactionIdentifier,
      TotalAmount: Number(amount)
    };

    log(`> POST ${url}`);
    log(`Body: ${JSON.stringify(body)}`);

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const txt = await r.text();
      let data;
      try {
        data = JSON.parse(txt);
      } catch {
        data = { raw: txt };
      }

      log(data);
      log(prettyPayment(data));
    } catch (err) {
      log("Error en la petición de captura:");
      log(err);
    }
  }

  async function doVoid() {
    const apiBase = apiBaseEl.value.trim();
    const id = prompt('Txn a anular (void)', lastTxnId || '');
    if (!id) return;
    const url = apiBase.replace(/\/+$/, '') + `/api/transactions/${encodeURIComponent(id)}/void`;
    log(`> POST ${url}`);
    const r = await fetch(url, { method: 'POST' });
    const txt = await r.text(); let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    log(data); log(prettyPayment(data));
  }

  async function doRefund() {
    const apiBase = apiBaseEl.value.trim();
    const id = prompt('Txn a reembolsar', lastTxnId || '');
    if (!id) return;
    const amount = prompt('Monto a reembolsar (vacío = total)', '');
    const url = apiBase.replace(/\/+$/, '') + `/api/transactions/${encodeURIComponent(id)}/refund`;
    log(`> POST ${url}`);
    const body = amount ? { TotalAmount: Number(amount) } : {};
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const txt = await r.text(); let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    log(data); log(prettyPayment(data));
  }

  async function doSearch() {
    const apiBase = apiBaseEl.value.trim();
    const orderId = prompt('Buscar por OrderIdentifier (opcional)', 'TEST123') || '';
    const url = apiBase.replace(/\/+$/, '') + `/api/transactions` + (orderId ? `?orderId=${encodeURIComponent(orderId)}` : '');
    log(`> GET ${url}`);
    const r = await fetch(url);
    const txt = await r.text(); let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    log(data);
  }

  // listeners
  document.querySelector('#btnCapture')?.addEventListener('click', doCapture);
  document.querySelector('#btnVoid')?.addEventListener('click', doVoid);
  document.querySelector('#btnRefund')?.addEventListener('click', doRefund);
  document.querySelector('#btnSearch')?.addEventListener('click', doSearch);
})();




