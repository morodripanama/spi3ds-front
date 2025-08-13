(function(){
  const $ = (sel) => document.querySelector(sel);
  const apiBaseEl = $('#apiBase');
  const merchantUrlEl = $('#merchantUrl');
  const terminalIdEl = $('#terminalId');
  const orderIdEl = $('#orderId');
  const amountEl = $('#amount');
  const currencyEl = $('#currency');
  const panEl = $('#pan');
  const expEl = $('#exp');
  const cvvEl = $('#cvv');
  const logEl = $('#log');
  const saleStatus = $('#saleStatus');
  const btn = $('#btnSale');

  // Defaults para tu deploy en Render
  if (apiBaseEl && !apiBaseEl.value) apiBaseEl.value = "https://smartpaypasarelas.onrender.com";
  if (merchantUrlEl && !merchantUrlEl.value) merchantUrlEl.value = "https://smartpaypasarelas.onrender.com/api/spi/3ds/return";

  function log(o){
    const s = (typeof o === 'string') ? o : JSON.stringify(o, null, 2);
    logEl.textContent = (logEl.textContent + '\n' + s).slice(-40000);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ---------- Normalizadores requeridos por PTZ ----------
  // Moneda: ISO-4217 numérico (USD=840, PAB=590)
  const iso4217 = { USD: "840", PAB: "590" };

  // Expiración: convertir entrada de usuario a YYMM (o respetar YYMMDD si ya viene así)
  function normalizeExpiry(input) {
    const s = String(input || '').replace(/\D/g, '');
    if (s.length === 4) {            // asume MMYY -> YYMM
      const mm = s.slice(0,2), yy = s.slice(2,4);
      return yy + mm;
    }
    if (s.length === 6) return s;    // ya es YYMMDD
    if (s.length === 5) {            // caso raro: fuerza YYMM
      const mm = s.slice(0,2), yy = s.slice(-2);
      return yy + mm;
    }
    return s;                        // si ya venía YYMM, queda igual
  }

  async function callSale(){
    const apiBase = apiBaseEl.value.trim();
    if (!apiBase) return alert('Configura API_BASE');
    const merchantUrl = merchantUrlEl.value.trim();
    if (!merchantUrl) return alert('Configura MerchantResponseUrl');

    const rawAmount = Number(amountEl.value || '0');
    const currencyNumeric = iso4217[currencyEl.value] || currencyEl.value; // permite numérico directo
    const cardExp = normalizeExpiry(expEl.value);

    const body = {
      TotalAmount: rawAmount,
      CurrencyCode: currencyNumeric,      // ISO numérico (ej: 840)
      ThreeDSecure: true,
      TerminalId: terminalIdEl.value || undefined,
      OrderIdentifier: orderIdEl.value || undefined,
      Source: {
        CardPan: panEl.value,
        CardExpiration: cardExp,          // YYMM (o YYMMDD)
        CardCvv: cvvEl.value
      },
      ExtendedData: {
        MerchantResponseUrl: merchantUrl,
        BrowserInfo: {
          UserAgent: navigator.userAgent,
          IP: '',
          JavascriptEnabled: true,
          Language: navigator.language,
          ScreenHeight: String(window.screen.height),
          ScreenWidth: String(window.screen.width),
          TimeZone: String(-new Date().getTimezoneOffset()/60),
          ColorDepth: String(window.screen.colorDepth)
        }
      }
    };

    // Log del payload que realmente mandamos
    log('Payload que se enviará a /api/spi/sale:');
    log(body);

    const url = apiBase.replace(/\/+$/,'') + '/api/spi/sale';
    log(`> POST ${url}`);
    saleStatus.textContent = 'llamando…';
    btn.disabled = true;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const ctype = (r.headers.get('content-type') || '').toLowerCase();
      log(`HTTP ${r.status} ${r.statusText} — content-type: ${ctype || '(desconocido)'}`);
      const txt = await r.text();

      // Si es HTML, es muy probablemente el formulario del ACS
      if (ctype.includes('text/html') || /^<!doctype|<html/i.test(txt)) {
        log('HTML recibido (posible ACS). Abriendo ventana/popup…');
        openHtmlPopup(txt);
        return;
      }

      // Intentar parsear JSON
      let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
      log(data);

      // 1) HTML embebido en JSON
      if (data && typeof data.RedirectHtml === 'string' && /<html|<form/i.test(data.RedirectHtml)) {
        openHtmlPopup(data.RedirectHtml);
        return;
      }
      // 2) URL directa de redirección
      if (data && data.RedirectUrl) {
        open(data.RedirectUrl, 'ptz3ds', 'width=430,height=700');
        return;
      }
      // 3) ACS + PaReq
      const acs = data?.AcsUrl || data?.ACSUrl || data?.ThreeDS?.AcsUrl || data?.ThreeDSecure?.AcsUrl;
      const pareq = data?.PaReq || data?.PAReq || data?.ThreeDS?.PaReq || data?.ThreeDSecure?.PaReq || data?.Payload;
      const md = data?.MD || data?.Md || data?.ThreeDS?.MD || data?.ThreeDSecure?.MD;
      if (acs) {
        const html = buildAutoPostHtml(acs, { PaReq: pareq || '', TermUrl: merchantUrl, MD: md || '' });
        openHtmlPopup(html);
        return;
      }

      alert('No se encontró información de redirección 3DS en la respuesta. Revisa el backend/respuesta.');
    } catch (e) {
      console.error(e);
      log('Error en fetch: ' + (e.message || e.toString()));
    } finally {
      saleStatus.textContent = ''; btn.disabled = false;
    }
  }

  function buildAutoPostHtml(actionUrl, fields){
    const inputs = Object.entries(fields).map(([k,v]) =>
      `<input type="hidden" name="${k}" value="${String(v||'').replace(/\"/g,'&quot;')}" />`).join('');
    return `<!doctype html><html><body onload="document.forms[0].submit()">
      <form method="POST" action="${actionUrl}">${inputs}</form>
      <p style="font:14px system-ui">Redirigiendo a ACS…</p>
    </body></html>`;
  }

  function openHtmlPopup(html){
    const w = open('', 'ptz3ds', 'width=430,height=700');
    if (!w) { alert('El navegador bloqueó el popup. Permite ventanas emergentes y reintenta.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // Recibe el SpiToken del callback y ejecuta /payment
  window.addEventListener('message', async (ev) => {
    if (!ev || !ev.data || ev.data.type !== 'PTZ_3DS_DONE') return;
    const payload = ev.data.payload || {};
    log('Mensaje 3DS recibido'); log(payload);
    if (!payload.SpiToken) { log('No llegó SpiToken; revisa el callback.'); return; }

    const apiBase = apiBaseEl.value.trim();
    const payUrl = apiBase.replace(/\/+$/,'') + '/api/spi/payment';
    log(`> POST ${payUrl}`);
    try {
      const r = await fetch(payUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ SpiToken: payload.SpiToken })
      });
      const txt = await r.text();
      let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
      log('> /api/spi/payment respuesta:'); log(data);
    } catch(e) { log(e.message || e.toString()); }
  });

  btn.addEventListener('click', callSale);
})();



