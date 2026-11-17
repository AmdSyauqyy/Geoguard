# GeoGuard ID — versi HTML, CSS, dan JavaScript

Proyek ini merupakan konversi frontend dari aplikasi Streamlit GeoGuard ID.

## Isi folder

- `index.html` — struktur halaman dashboard.
- `style.css` — seluruh styling dan layout responsif.
- `script.js` — interaksi halaman, kalkulasi FoS, grafik, peta, pencarian lokasi, laporan warga, dan pemicu peringatan.
- `server.py` — server Python standar (tanpa Flask) untuk menyajikan website dan menjadi proxy Telegram yang menjaga token tetap di sisi server.

## Menjalankan website

1. Pastikan Python 3 sudah terpasang.
2. Buka terminal pada folder proyek ini.
3. Jalankan:

   ```bash
   python server.py
   ```

4. Buka `http://127.0.0.1:8000` pada browser.

Koneksi internet diperlukan untuk Google Fonts, peta OpenStreetMap, Plotly, Leaflet, Open-Meteo, dan Nominatim. File HTML sebaiknya dibuka melalui `server.py`, bukan dengan klik dua kali, agar endpoint Telegram tersedia.

## Mengaktifkan Telegram (opsional)

Token bot dan chat ID tidak dimasukkan ke file HTML atau JavaScript. Atur keduanya sebagai environment variable sebelum menjalankan server.

**Windows PowerShell:**

```powershell
$env:TELEGRAM_BOT_TOKEN="TOKEN_BOT_TELEGRAM"
$env:TELEGRAM_CHAT_ID="CHAT_ID_TELEGRAM"
python server.py
```

**Windows Command Prompt:**

```cmd
set TELEGRAM_BOT_TOKEN=TOKEN_BOT_TELEGRAM
set TELEGRAM_CHAT_ID=CHAT_ID_TELEGRAM
python server.py
```

Kemudian buka tab **Peringatan**, aktifkan notifikasi otomatis, atau tekan tombol tes kirim Telegram.

## Fitur yang dipertahankan

- Pencarian lokasi melalui Nominatim/OpenStreetMap.
- Data curah hujan per jam dan akumulasi 24 jam dari Open-Meteo.
- Perhitungan FoS dengan model infinite-slope sederhana sesuai rumus pada file sumber.
- Parameter simulasi tanah dan lereng.
- Peta lokasi, grafik hujan, grafik tren simulasi, visualisasi topografi 3D, penampang lereng, dan analisis sensitivitas.
- Pusat peringatan dan notifikasi Telegram opsional melalui backend.
- Form laporan warga dan unduhan CSV.

## Batasan

- Parameter tanah, kadar air, laju pergeseran, topografi 3D, dan deformasi tetap berupa simulasi/input pengguna seperti versi sumber.
- Curah hujan Open-Meteo merupakan estimasi model cuaca, bukan data sensor hujan lokal.
- Laporan warga hanya tersimpan di memori halaman aktif; laporan akan hilang saat halaman dimuat ulang.
- Website belum terhubung ke ESP32, sensor fisik, relay, atau sirine.
- Nilai FoS dan status pada prototype ini tidak tervalidasi untuk keputusan keselamatan atau evakuasi lapangan.
