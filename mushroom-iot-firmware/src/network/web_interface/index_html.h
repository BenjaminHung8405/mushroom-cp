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
<title>TraiNam - Cấu hình WiFi</title>
<style>
:root { --ok:#1e8e3e; --err:#d93025; --pri:#1a73e8; --bg:#f0f2f5; --card:#ffffff; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; margin: 0; background: var(--bg); color: #202124; }
.wrap { max-width: 460px; margin: 0 auto; padding: 14px; }
.card { background: var(--card); border-radius: 14px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
.header { text-align: center; margin-bottom: 16px; }
h1 { font-size: 21px; font-weight: 700; margin: 0 0 4px; color: #1a73e8; }
.sub { font-size: 13px; color: #5f6368; margin: 0; line-height: 1.4; }
.dev-badge { display: inline-block; background: #e8f0fe; color: #174ea6; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 20px; margin-top: 8px; font-family: monospace; }

label { display:block; font-size: 13px; font-weight: 600; color: #3c4043; margin: 12px 0 6px; }
input[type=text], input[type=password], input[type=number], select {
  width: 100%; font-size: 16px; padding: 12px; border: 1px solid #dadce0; border-radius: 8px; background: #fff;
  transition: border-color 0.2s;
}
input:focus, select:focus { outline: none; border-color: var(--pri); box-shadow: 0 0 0 3px rgba(26,115,232,0.15); }
.row { display:flex; gap:8px; align-items:stretch; }
.row > :first-child { flex:1; min-width:0; }
.btn {
  font-size: 14px; font-weight: 600; border-radius: 8px; border: 1px solid #dadce0; background:#fff; color:#3c4043;
  padding: 0 14px; min-height: 46px; cursor: pointer; white-space: nowrap; transition: background 0.2s;
}
.btn:active { background: #f1f3f4; }
.btn-pri { background: var(--ok); color:#fff; border-color: var(--ok); width:100%; font-size:16px; margin-top:18px; font-weight: 700; }
.btn-pri:disabled { opacity: .65; cursor: wait; }
.btn-sec { background:#e8f0fe; color:var(--pri); border-color:#aecbfa; width:100%; margin-top:8px; }
.btn-toggle { min-width: 68px; color:var(--pri); border-color:#aecbfa; background:#e8f0fe; }
.btn-del { padding: 4px 10px; min-height: 32px; font-size: 12px; color: var(--err); border-color: #f5c6c2; background: #fce8e6; }

details { margin-top: 16px; border-top: 1px solid #eee; padding-top: 12px; }
summary { color: var(--pri); font-weight: 600; cursor: pointer; outline:none; font-size: 14px; }
.msg { display:none; margin-top: 14px; padding: 12px 14px; border-radius: 8px; font-size: 14px; line-height: 1.5; }
.msg.show { display:block; }
.msg.ok { background:#e6f4ea; color:#137333; border:1px solid #ceead6; }
.msg.err { background:#fce8e6; color:#a50e0e; border:1px solid #f5c6c2; }
.msg.info { background:#e8f0fe; color:#174ea6; border:1px solid #d2e3fc; }

.section-title { font-size: 13px; font-weight: 700; color: #5f6368; text-transform: uppercase; letter-spacing: 0.5px; margin: 16px 0 8px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
.known-box { margin-bottom: 12px; }
.known-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #f8f9fa; border: 1px solid #e8eaed; border-radius: 8px; margin-bottom: 6px; font-size: 14px; }

.scan-box { margin-top:8px; max-height:180px; overflow:auto; border:1px solid #e0e0e0; border-radius:8px; display:none; }
.scan-item { display:flex; justify-content:space-between; align-items:center; width:100%; text-align:left; padding:11px 13px; border:0; border-bottom:1px solid #f1f3f4; background:#fff; font-size:14px; cursor:pointer; }
.scan-item:last-child { border-bottom:0; }
.scan-item:active { background:#e8f0fe; }
.rssi-bar { font-family: monospace; font-size: 13px; }

.meta { font-size:11px; color:#80868b; margin-top:16px; text-align:center; line-height:1.5; }
.spinner { display:inline-block; width:14px; height:14px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; vertical-align:-2px; margin-right:6px; animation:spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="wrap"><div class="card">
  <div class="header">
    <h1>Trai Nam - Cấu hình WiFi</h1>
    <p class="sub">Kết nối bộ điều khiển nhà nấm vào mạng Wi-Fi trang trại</p>
    <div class="dev-badge">AP: %AP_SSID% | ID: %MQTT_USER%</div>
  </div>

  <div id="banner" class="msg"></div>

  <div id="knownSection" style="display:none;">
    <div class="section-title">Wi-Fi Đã Ghi Nhớ (Tối đa 5 mạng)</div>
    <div id="knownBox" class="known-box"></div>
  </div>

  <form id="cfgForm" autocomplete="off" onsubmit="return false;">
    <div class="section-title">Thiết Lập Kết Nối Mới</div>
    <label for="ssid">Tên Mạng Wi-Fi (SSID)</label>
    <div class="row">
      <input id="ssid" name="ssid" type="text" value="%SSID%" maxlength="32" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Nhập hoặc chọn Wi-Fi" required>
    </div>
    <button type="button" class="btn btn-sec" id="btnScan" onclick="scanWifi()">Quét mạng Wi-Fi xung quanh 🔍</button>
    <div id="scanBox" class="scan-box"></div>

    <label for="pass">Mật Khẩu Wi-Fi</label>
    <div class="row">
      <input id="pass" name="pass" type="password" value="%PASS%" maxlength="64" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Nhập mật khẩu">
      <button type="button" class="btn btn-toggle" id="btnPass" onclick="togglePass('pass','btnPass')">Hiện</button>
    </div>

    <button type="button" class="btn btn-pri" id="btnSave" onclick="saveConfig()">Kiểm Tra & Lưu Kết Nối 🚀</button>
  </form>

  <p class="meta">Điện thoại giữ kết nối vào Wi-Fi <b>%AP_SSID%</b><br>Địa chỉ quản trị: <b>http://192.168.4.1</b></p>
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
  if(el.type === 'password'){ el.type='text'; if(btn) btn.textContent='Ẩn'; }
  else { el.type='password'; if(btn) btn.textContent='Hiện'; }
}

function setBusy(busy, label){
  var b = $('btnSave');
  if(!b) return;
  b.disabled = !!busy;
  b.innerHTML = busy ? ('<span class="spinner"></span>' + (label||'Đang thử kết nối...')) : 'Kiểm Tra & Lưu Kết Nối 🚀';
}

function rssiIcon(rssi){
  if(rssi >= -60) return '📶📶📶📶';
  if(rssi >= -70) return '📶📶📶';
  if(rssi >= -80) return '📶📶';
  return '📶';
}

function loadKnownNetworks(){
  var x = new XMLHttpRequest();
  x.open('GET', '/known-networks?t=' + Date.now(), true);
  x.timeout = 5000;
  x.onreadystatechange = function(){
    if(x.readyState !== 4 || x.status !== 200) return;
    try {
      var list = JSON.parse(x.responseText || '[]');
      var sec = $('knownSection');
      var box = $('knownBox');
      if(!list.length){
        sec.style.display = 'none';
        return;
      }
      sec.style.display = 'block';
      box.innerHTML = '';
      for(var i=0; i<list.length; i++){
        (function(net){
          var item = document.createElement('div');
          item.className = 'known-item';
          item.innerHTML = '<span><b>' + escapeHtml(net.ssid) + '</b></span>';
          var delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'btn btn-del';
          delBtn.textContent = 'Xóa';
          delBtn.onclick = function(){ forgetNetwork(net.ssid); };
          item.appendChild(delBtn);
          box.appendChild(item);
        })(list[i]);
      }
    } catch(e){}
  };
  x.send();
}

function forgetNetwork(ssid){
  if(!confirm('Xóa Wi-Fi "' + ssid + '" khỏi danh sách ghi nhớ?')) return;
  var x = new XMLHttpRequest();
  x.open('POST', '/forget-network', true);
  x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  x.onreadystatechange = function(){
    if(x.readyState === 4 && x.status === 200){
      showMsg('ok', 'Đã xóa mạng Wi-Fi "' + escapeHtml(ssid) + '".');
      loadKnownNetworks();
    }
  };
  x.send('ssid=' + encodeURIComponent(ssid));
}

function escapeHtml(str){
  return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function scanWifi(){
  var box = $('scanBox');
  var btn = $('btnScan');
  btn.disabled = true;
  btn.textContent = 'Đang quét sóng... 🔍';
  box.style.display = 'block';
  box.innerHTML = '<div class="scan-item">Đang dò tìm mạng xung quanh...</div>';
  var x = new XMLHttpRequest();
  x.open('GET', '/scan?t=' + Date.now(), true);
  x.timeout = 12000;
  x.onreadystatechange = function(){
    if(x.readyState !== 4) return;
    btn.disabled = false;
    btn.textContent = 'Quét mạng Wi-Fi xung quanh 🔍';
    if(x.status !== 200){
      box.innerHTML = '<div class="scan-item">Quét thất bại. Hãy nhập SSID thủ công.</div>';
      return;
    }
    try {
      var list = JSON.parse(x.responseText || '[]');
      if(!list.length){
        box.innerHTML = '<div class="scan-item">Không tìm thấy Wi-Fi 2.4GHz nào.</div>';
        return;
      }
      box.innerHTML = '';
      for(var i=0;i<list.length;i++){
        (function(item){
          var a = document.createElement('button');
          a.type = 'button';
          a.className = 'scan-item';
          var lock = item.secure ? ' 🔒' : ' 🔓';
          a.innerHTML = '<span>' + escapeHtml(item.ssid) + lock + '</span><span class="rssi-bar">' + rssiIcon(item.rssi) + ' (' + item.rssi + ' dBm)</span>';
          a.onclick = function(){ $('ssid').value = item.ssid; $('pass').focus(); };
          box.appendChild(a);
        })(list[i]);
      }
    } catch(e){
      box.innerHTML = '<div class="scan-item">Lỗi đọc danh sách mạng.</div>';
    }
  };
  x.onerror = function(){
    btn.disabled = false;
    btn.textContent = 'Quét mạng Wi-Fi xung quanh 🔍';
    box.innerHTML = '<div class="scan-item">Mất kết nối AP khi quét. Thử lại.</div>';
  };
  x.send();
}

function saveConfig(){
  var ssid = ($('ssid').value || '').trim();
  if(!ssid){
    showMsg('err', 'Vui lòng nhập Wi-Fi SSID.');
    $('ssid').focus();
    return;
  }

  setBusy(true, 'Đang thử kết nối router...');
  showMsg('info', '⌛ Đang thử kết nối tới Wi-Fi <b>' + escapeHtml(ssid) + '</b>... Vui lòng chờ 5-8 giây.');

  var body =
    'ssid=' + encodeURIComponent(ssid) +
    '&pass=' + encodeURIComponent($('pass').value || '');

  var x = new XMLHttpRequest();
  x.open('POST', '/save', true);
  x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  x.timeout = 15000;
  x.onreadystatechange = function(){
    if(x.readyState !== 4) return;
    if(x.status >= 200 && x.status < 300){
      var resp = {};
      try { resp = JSON.parse(x.responseText || '{}'); } catch(e) {}
      if(resp.ok){
        showMsg('ok', '✅ <b>Thành công!</b> Router đã cấp IP: <b>' + (resp.ip||'OK') + '</b>.<br>Thiết bị đã lưu mạng này và đang khởi động lại. Bạn có thể đóng trang này.');
        setBusy(true, 'Đã lưu - Đang Reboot...');
      } else {
        showMsg('err', '❌ ' + (resp.error || 'Không thể kết nối Wi-Fi. Kiểm tra lại mật khẩu.'));
        setBusy(false);
      }
    } else {
      showMsg('err', '❌ Không thể kết nối tới Router Wi-Fi. Vui lòng kiểm tra lại mật khẩu hoặc sóng Wi-Fi.');
      setBusy(false);
    }
  };
  x.onerror = function(){
    showMsg('err', '⚠️ Không thể gửi lệnh tới thiết bị. Kiểm tra lại kết nối Wi-Fi AP.');
    setBusy(false);
  };
  x.ontimeout = function(){
    showMsg('err', '❌ Hết thời gian chờ (Timeout). Router không phản hồi.');
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

loadKnownNetworks();
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
