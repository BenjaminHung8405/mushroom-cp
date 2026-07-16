#pragma once
#include <Arduino.h>

#ifndef PROGMEM
#define PROGMEM
#endif

// Captive Portal HTML Template for WiFi provisioning
const char PORTAL_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="format-detection" content="telephone=no">
<title>TraiNam Cau Hinh WiFi</title>
<style>
:root { --ok:#1e8e3e; --err:#d93025; --pri:#1a73e8; --bg:#f0f2f5; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif; margin: 0; background: var(--bg); color: #202124; }
.wrap { max-width: 440px; margin: 0 auto; padding: 16px; }
.card { background: #fff; border-radius: 12px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
h1 { font-size: 20px; margin: 0 0 6px; text-align: center; }
.sub { font-size: 13px; color: #5f6368; text-align: center; margin: 0 0 16px; line-height: 1.4; }
label { display:block; font-size: 13px; font-weight: 600; color: #3c4043; margin: 12px 0 6px; }
input[type=text], input[type=password], input[type=number], select {
  width: 100%; font-size: 16px; padding: 12px; border: 1px solid #dadce0; border-radius: 8px; background: #fff;
}
input:focus, select:focus { outline: 2px solid #aecbfa; border-color: var(--pri); }
.row { display:flex; gap:8px; align-items:stretch; }
.row > :first-child { flex:1; min-width:0; }
.btn {
  font-size: 14px; font-weight: 600; border-radius: 8px; border: 1px solid #dadce0; background:#fff; color:#3c4043;
  padding: 0 12px; min-height: 46px; cursor: pointer; white-space: nowrap;
}
.btn-pri { background: var(--ok); color:#fff; border-color: var(--ok); width:100%; font-size:16px; margin-top:16px; }
.btn-pri:disabled { opacity: .65; cursor: wait; }
.btn-sec { background:#e8f0fe; color:var(--pri); border-color:#aecbfa; width:100%; margin-top:8px; }
.btn-toggle { min-width: 72px; color:var(--pri); border-color:#aecbfa; background:#e8f0fe; }
details { margin-top: 14px; border-top: 1px solid #eee; padding-top: 10px; }
summary { color: var(--pri); font-weight: 600; cursor: pointer; outline:none; }
.msg { display:none; margin-top: 12px; padding: 10px 12px; border-radius: 8px; font-size: 14px; line-height: 1.4; }
.msg.show { display:block; }
.msg.ok { background:#e6f4ea; color:#137333; border:1px solid #ceead6; }
.msg.err { background:#fce8e6; color:#a50e0e; border:1px solid #f5c6c2; }
.msg.info { background:#e8f0fe; color:#174ea6; border:1px solid #d2e3fc; }
.scan-box { margin-top:8px; max-height:160px; overflow:auto; border:1px solid #e0e0e0; border-radius:8px; display:none; }
.scan-item { display:block; width:100%; text-align:left; padding:10px 12px; border:0; border-bottom:1px solid #f1f3f4; background:#fff; font-size:14px; cursor:pointer; }
.scan-item:last-child { border-bottom:0; }
.scan-item:active { background:#e8f0fe; }
.meta { font-size:11px; color:#80868b; margin-top:14px; text-align:center; line-height:1.4; }
.spinner { display:inline-block; width:14px; height:14px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; vertical-align:-2px; margin-right:6px; animation:spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="wrap"><div class="card">
  <h1>Trai Nam - Cau hinh WiFi</h1>
  <p class="sub">Buoc 1: chon/nhap WiFi nha ban.<br>Buoc 2: bam Luu. May se tu ket noi lai.</p>

  <div id="banner" class="msg"></div>

  <form id="cfgForm" autocomplete="off" onsubmit="return false;">
    <label for="ssid">WiFi SSID</label>
    <div class="row">
      <input id="ssid" name="ssid" type="text" value="%SSID%" maxlength="32" autocapitalize="none" autocorrect="off" spellcheck="false" required>
    </div>
    <button type="button" class="btn btn-sec" id="btnScan" onclick="scanWifi()">Quet mang WiFi xung quanh</button>
    <div id="scanBox" class="scan-box"></div>

    <label for="pass">WiFi Password</label>
    <div class="row">
      <input id="pass" name="pass" type="password" value="%PASS%" maxlength="64" autocapitalize="none" autocorrect="off" spellcheck="false">
      <button type="button" class="btn btn-toggle" id="btnPass" onclick="togglePass('pass','btnPass')">Hien</button>
    </div>

    <p style="color: #5f6368; font-size: 13px; margin-top: 12px; margin-bottom: 4px; text-align: center;">Device ID: <span style="font-family: monospace; font-weight: bold; color: #202124;">%MQTT_USER%</span></p>

    <details id="adv">
      <summary>Cau hinh nang cao (tuy chon)</summary>
      <label for="backend_url">Backend API URL</label>
      <input id="backend_url" name="backend_url" type="text" value="%BACKEND_URL%" autocapitalize="none" autocorrect="off" spellcheck="false">

      <label for="mqtt_broker">MQTT Broker IP</label>
      <input id="mqtt_broker" name="mqtt_broker" type="text" value="%MQTT_BROKER%" autocapitalize="none" autocorrect="off" spellcheck="false">

      <label for="mqtt_port">MQTT Port</label>
      <input id="mqtt_port" name="mqtt_port" type="number" value="%MQTT_PORT%" min="1" max="65535">
    </details>

    <button type="button" class="btn btn-pri" id="btnSave" onclick="saveConfig()">Luu & Khoi dong lai</button>
  </form>

  <p class="meta">Neu mat ket noi AP: mo WiFi, ket noi lai <b>TraiNam_Setup_KhongDay</b><br>roi mo trinh duyet toi <b>192.168.4.1</b></p>
</div></div>

<script>
function $(id){ return document.getElementById(id); }
function showMsg(type, text){
  var el = $('banner');
  el.className = 'msg show ' + type;
  el.innerHTML = text;
}
function togglePass(inputId, btnId){
  var el = $(inputId), btn = $(btnId);
  if(!el) return;
  if(el.type === 'password'){ el.type='text'; if(btn) btn.textContent='An'; }
  else { el.type='password'; if(btn) btn.textContent='Hien'; }
}
function setBusy(busy, label){
  var b = $('btnSave');
  if(!b) return;
  b.disabled = !!busy;
  b.innerHTML = busy ? ('<span class="spinner"></span>' + (label||'Dang luu...')) : 'Luu & Khoi dong lai';
}
function scanWifi(){
  var box = $('scanBox');
  var btn = $('btnScan');
  btn.disabled = true;
  btn.textContent = 'Dang quet...';
  box.style.display = 'block';
  box.innerHTML = '<div class="scan-item">Dang quet mang...</div>';
  var x = new XMLHttpRequest();
  x.open('GET', '/scan?t=' + Date.now(), true);
  x.timeout = 12000;
  x.onreadystatechange = function(){
    if(x.readyState !== 4) return;
    btn.disabled = false;
    btn.textContent = 'Quet mang WiFi xung quanh';
    if(x.status !== 200){
      box.innerHTML = '<div class="scan-item">Quet that bai. Hay nhap SSID thu cong.</div>';
      return;
    }
    try {
      var list = JSON.parse(x.responseText || '[]');
      if(!list.length){
        box.innerHTML = '<div class="scan-item">Khong thay mang nao. Hay nhap SSID thu cong.</div>';
        return;
      }
      box.innerHTML = '';
      for(var i=0;i<list.length;i++){
        (function(item){
          var a = document.createElement('button');
          a.type = 'button';
          a.className = 'scan-item';
          var lock = item.secure ? ' 🔒' : ' 🔓';
          a.textContent = item.ssid + lock + '  (' + item.rssi + ' dBm)';
          a.onclick = function(){ $('ssid').value = item.ssid; $('pass').focus(); };
          box.appendChild(a);
        })(list[i]);
      }
    } catch(e){
      box.innerHTML = '<div class="scan-item">Loi doc ket qua quet.</div>';
    }
  };
  x.onerror = function(){
    btn.disabled = false;
    btn.textContent = 'Quet mang WiFi xung quanh';
    box.innerHTML = '<div class="scan-item">Mat ket noi AP khi quet. Thu lai.</div>';
  };
  x.send();
}
function saveConfig(){
  var ssid = ($('ssid').value || '').trim();
  if(!ssid){
    showMsg('err', 'Vui long nhap WiFi SSID.');
    $('ssid').focus();
    return;
  }
  var port = parseInt(($('mqtt_port').value || '18883'), 10);
  if(isNaN(port) || port < 1 || port > 65535){
    showMsg('err', 'MQTT Port khong hop le.');
    return;
  }

  setBusy(true, 'Dang luu...');
  showMsg('info', 'Dang gui cau hinh toi thiet bi...');

  var body =
    'ssid=' + encodeURIComponent(ssid) +
    '&pass=' + encodeURIComponent($('pass').value || '') +
    '&backend_url=' + encodeURIComponent(($('backend_url').value || '').trim()) +
    '&mqtt_broker=' + encodeURIComponent(($('mqtt_broker').value || '').trim()) +
    '&mqtt_port=' + encodeURIComponent(String(port));

  var x = new XMLHttpRequest();
  x.open('POST', 'http://192.168.4.1/save', true);
  x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  x.timeout = 20000;
  x.onreadystatechange = function(){
    if(x.readyState !== 4) return;
    if(x.status >= 200 && x.status < 300){
      var resp = {};
      try { resp = JSON.parse(x.responseText || '{}'); } catch(e) {}
      if(resp.ok){
        showMsg('ok', 'Da luu thanh cong! Thiet bi dang khoi dong lai va se ket noi WiFi <b>' + ssid + '</b>. Ban co the dong trang nay.');
        setBusy(true, 'Da luu - dang reboot...');
      } else {
        showMsg('err', (resp.error || 'Luu that bai. Thu lai.'));
        setBusy(false);
      }
    } else if(x.status === 0){
      showMsg('ok', 'Da gui lenh luu. Neu AP bien mat, thiet bi dang reboot de ket noi WiFi moi.');
      setBusy(true, 'Da gui lenh...');
    } else {
      showMsg('err', 'Loi HTTP ' + x.status + '. Kiem tra ket noi AP roi thu lai.');
      setBusy(false);
    }
  };
  x.onerror = function(){
    showMsg('ok', 'Mat ket noi AP sau khi gui. Neu dung, thiet bi dang reboot de vao WiFi moi.');
    setBusy(true, 'Da gui lenh...');
  };
  x.ontimeout = function(){
    showMsg('err', 'Het thoi gian cho phan hoi. Hay giu ket noi AP va bam Luu lai.');
    setBusy(false);
  };
  x.send(body);
}
setInterval(function(){
  try {
    var x = new XMLHttpRequest();
    x.open('GET', '/keep-alive?t=' + Date.now(), true);
    x.timeout = 2000;
    x.send();
  } catch(e) {}
}, 12000);
</script>
</body>
</html>
)rawliteral";

// Local Dashboard HTML Template
const char DASHBOARD_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mushroom CP - Control Panel</title>
    <style>
        :root {
            --bg-color: #0b0c10;
            --card-bg: rgba(31, 40, 51, 0.45);
            --border-color: rgba(255, 255, 255, 0.08);
            --text-main: #c5c6c7;
            --text-title: #ffffff;
            --text-muted: #868686;
            --primary: #45f3ff;
            --primary-glow: rgba(69, 243, 255, 0.15);
            --temp-color: #ff0055;
            --temp-glow: rgba(255, 0, 85, 0.15);
            --humid-color: #00ffaa;
            --humid-glow: rgba(0, 255, 170, 0.15);
            --co2-color: #ffaa00;
            --co2-glow: rgba(255, 170, 0, 0.15);
            --success: #00ff66;
            --danger: #ff3333;
        }
        body {
            background-color: var(--bg-color);
            color: var(--text-main);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 1.5rem;
            display: flex;
            justify-content: center;
            min-height: 100vh;
        }
        .container {
            max-width: 900px;
            width: 100%;
        }
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 1rem;
            margin-bottom: 2rem;
        }
        h1 {
            font-size: 1.6rem;
            font-weight: 600;
            margin: 0;
            color: var(--text-title);
            background: linear-gradient(45deg, var(--primary), #a855f7);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 0 0 20px rgba(69, 243, 255, 0.2);
        }
        .status-container {
            display: flex;
            gap: 0.5rem;
        }
        .badge {
            padding: 0.3rem 0.6rem;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.3rem;
            border: 1px solid var(--border-color);
            background-color: rgba(255, 255, 255, 0.02);
            transition: all 0.3s ease;
        }
        .badge-online {
            border-color: rgba(0, 255, 102, 0.2);
            color: var(--success);
            text-shadow: 0 0 5px rgba(0, 255, 102, 0.3);
        }
        .badge-offline {
            border-color: rgba(255, 51, 51, 0.2);
            color: var(--danger);
            text-shadow: 0 0 5px rgba(255, 51, 51, 0.3);
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 1.5rem;
        }
        .card {
            background: var(--card-bg);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.25rem;
            position: relative;
            overflow: hidden;
            transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
        }
        .card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; width: 100%; height: 3px;
        }
        .card-temp::before { background: var(--temp-color); }
        .card-temp:hover { border-color: var(--temp-color); box-shadow: 0 5px 20px var(--temp-glow); }
        .card-humid::before { background: var(--humid-color); }
        .card-humid:hover { border-color: var(--humid-color); box-shadow: 0 5px 20px var(--humid-glow); }
        .card-co2::before { background: var(--co2-color); }
        .card-co2:hover { border-color: var(--co2-color); box-shadow: 0 5px 20px var(--co2-glow); }
        .card-outputs::before { background: var(--primary); }
        .card-outputs:hover { border-color: var(--primary); box-shadow: 0 5px 20px var(--primary-glow); }

        .card-title {
            font-size: 0.8rem;
            color: var(--text-muted);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.5rem;
        }
        .card-value-wrapper {
            display: flex;
            align-items: baseline;
            gap: 0.3rem;
            margin-bottom: 0.5rem;
        }
        .card-value {
            font-size: 2.2rem;
            font-weight: 700;
            color: var(--text-title);
        }
        .card-unit {
            font-size: 1.1rem;
            color: var(--text-muted);
        }
        .card-target {
            font-size: 0.8rem;
            color: var(--text-muted);
            display: flex;
            justify-content: space-between;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            padding-top: 0.5rem;
            margin-top: 0.5rem;
        }
        .target-val {
            font-weight: 600;
            color: var(--text-title);
        }
        .output-item {
            margin-bottom: 0.8rem;
        }
        .output-item:last-child {
            margin-bottom: 0;
        }
        .output-header {
            display: flex;
            justify-content: space-between;
            font-size: 0.8rem;
            margin-bottom: 0.25rem;
        }
        .output-label {
            font-weight: 600;
        }
        .output-val {
            font-family: monospace;
            color: var(--text-title);
        }
        .progress-bg {
            height: 6px;
            background-color: rgba(255, 255, 255, 0.05);
            border-radius: 3px;
            overflow: hidden;
        }
        .progress-bar {
            height: 100%;
            width: 0%;
            border-radius: 3px;
            transition: width 0.8s cubic-bezier(0.165, 0.84, 0.44, 1);
        }
        .pb-hair { background: linear-gradient(90deg, #ff0055, #ff5500); }
        .pb-hwat { background: linear-gradient(90deg, #ffaa00, #ff5500); }
        .pb-mist { background: linear-gradient(90deg, #00ffaa, #00aaff); }
        .pb-exh { background: linear-gradient(90deg, var(--primary), #a855f7); }
        
        .footer {
            margin-top: 3rem;
            text-align: center;
            font-size: 0.75rem;
            color: var(--text-muted);
            border-top: 1px solid var(--border-color);
            padding-top: 1rem;
        }
        .footer span {
            margin: 0 0.5rem;
        }
        .footer-val {
            color: var(--text-title);
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>MUSHROOM CONTROL PANEL</h1>
            <div class="status-container">
                <div id="wifi-badge" class="badge badge-offline">○ WiFi Connected</div>
                <div id="mqtt-badge" class="badge badge-offline">○ MQTT Connected</div>
            </div>
        </header>
        
        <div class="grid">
            <div class="card card-temp">
                <div class="card-title">Air Temperature</div>
                <div class="card-value-wrapper">
                    <span id="temp-val" class="card-value">--.-</span>
                    <span class="card-unit">°C</span>
                </div>
                <div class="card-target">
                    <span>Target Setpoint</span>
                    <span class="target-val"><span id="temp-target">--.-</span> °C</span>
                </div>
            </div>
            
            <div class="card card-humid">
                <div class="card-title">Air Humidity</div>
                <div class="card-value-wrapper">
                    <span id="humid-val" class="card-value">--</span>
                    <span class="card-unit">% RH</span>
                </div>
                <div class="card-target">
                    <span>Target Setpoint</span>
                    <span class="target-val"><span id="humid-target">--</span> % RH</span>
                </div>
            </div>
            
            <div class="card card-co2">
                <div class="card-title">CO2 Concentration</div>
                <div class="card-value-wrapper">
                    <span id="co2-val" class="card-value">----</span>
                    <span class="card-unit">ppm</span>
                </div>
                <div class="card-target">
                    <span>Target Setpoint</span>
                    <span class="target-val"><span id="co2-target">----</span> ppm</span>
                </div>
            </div>
            
            <div class="card card-outputs">
                <div class="card-title">Actuator Demands</div>
                <div class="output-item">
                    <div class="output-header">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <span class="output-label">Heat Lamp (HLamp)</span>
                            <span id="lamp1-badge" class="badge badge-offline" style="padding: 0.15rem 0.4rem; font-size: 0.65rem; display: inline-flex; border-radius: 4px; margin: 0;">○ L1 OFF</span>
                            <span id="lamp2-badge" class="badge badge-offline" style="padding: 0.15rem 0.4rem; font-size: 0.65rem; display: inline-flex; border-radius: 4px; margin: 0;">○ L2 OFF</span>
                        </div>
                        <span id="hair-val" class="output-val">0%</span>
                    </div>
                    <div class="progress-bg">
                        <div id="hair-bar" class="progress-bar pb-hair"></div>
                    </div>
                </div>
                <div class="output-item">
                    <div class="output-header">
                        <span class="output-label">Water Heater (HWat)</span>
                        <span id="hwat-val" class="output-val">0%</span>
                    </div>
                    <div class="progress-bg">
                        <div id="hwat-bar" class="progress-bar pb-hwat"></div>
                    </div>
                </div>
                <div class="output-item">
                    <div class="output-header">
                        <span class="output-label">Mist Humidifier</span>
                        <span id="mist-val" class="output-val">0%</span>
                    </div>
                    <div class="progress-bg">
                        <div id="mist-bar" class="progress-bar pb-mist"></div>
                    </div>
                </div>
                <div class="output-item">
                    <div class="output-header">
                        <span class="output-label">Exhaust Fan</span>
                        <span id="exh-val" class="output-val">0%</span>
                    </div>
                    <div class="progress-bg">
                        <div id="exh-bar" class="progress-bar pb-exh"></div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <span>Uptime: <span id="uptime-val" class="footer-val">0</span>s</span>
            <span>|</span>
            <span>Heap: <span id="heap-val" class="footer-val">0</span> KB</span>
        </div>
    </div>
    
    <script>
        function updateUI() {
            fetch('/data')
                .then(r => {
                    if (r.status === 429) {
                        console.warn('Rate limit exceeded (429)');
                        return null;
                    }
                    return r.json();
                })
                .then(data => {
                    if (!data) return;
                    
                    document.getElementById('temp-val').innerText = (data.temp_air !== undefined && data.temp_air !== null && !isNaN(data.temp_air)) ? data.temp_air.toFixed(1) : '--.-';
                    document.getElementById('humid-val').innerText = (data.humidity_air !== undefined && data.humidity_air !== null && !isNaN(data.humidity_air)) ? Math.round(data.humidity_air) : '--';
                    document.getElementById('co2-val').innerText = (data.co2_level !== undefined && data.co2_level !== null && !isNaN(data.co2_level)) ? Math.round(data.co2_level) : 'Offline';
                    
                    document.getElementById('temp-target').innerText = (data.temp_target !== undefined && data.temp_target !== null && !isNaN(data.temp_target)) ? data.temp_target.toFixed(1) : '--.-';
                    document.getElementById('humid-target').innerText = (data.humidity_target !== undefined && data.humidity_target !== null && !isNaN(data.humidity_target)) ? Math.round(data.humidity_target) : '--';
                    document.getElementById('co2-target').innerText = (data.co2_target !== undefined && data.co2_target !== null && !isNaN(data.co2_target)) ? Math.round(data.co2_target) : '----';
                    
                    updateBar('hair-bar', 'hair-val', data.h_lamp_duty);
                    updateBar('hwat-bar', 'hwat-val', data.h_wat_duty);
                    updateBar('mist-bar', 'mist-val', data.mist_duty);
                    updateBar('exh-bar', 'exh-val', data.exhaust_duty);
                    
                    updateBadge('wifi-badge', data.wifi_connected, 'WiFi Connected', 'WiFi Offline');
                    updateBadge('mqtt-badge', data.mqtt_connected, 'MQTT Connected', 'MQTT Offline');

                    if (data.actuators) {
                        updateBadge('lamp1-badge', data.actuators.lamp_stage_active, 'L1 ON', 'L1 OFF');
                        updateBadge('lamp2-badge', data.actuators.lamp_stage2_active, 'L2 ON', 'L2 OFF');
                    }
                    
                    document.getElementById('uptime-val').innerText = data.uptime || 0;
                    document.getElementById('heap-val').innerText = Math.round((data.free_heap || 0) / 1024);
                })
                .catch(e => console.error('Error fetching data:', e));
        }
        
        function updateBar(barId, valId, val) {
            const num = (val !== undefined && val !== null) ? val : 0;
            const pct = Math.round(num * 100);
            document.getElementById(barId).style.width = pct + '%';
            document.getElementById(valId).innerText = pct + '%';
        }
        
        function updateBadge(id, state, textOn, textOff) {
            const el = document.getElementById(id);
            if (state) {
                el.className = 'badge badge-online';
                el.innerText = '● ' + textOn;
            } else {
                el.className = 'badge badge-offline';
                el.innerText = '○ ' + textOff;
            }
        }
        
        setInterval(updateUI, 2000);
        updateUI();
    </script>
</body>
</html>
)rawliteral";
