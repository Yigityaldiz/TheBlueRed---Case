# AI Destekli SUT Uygunluk Denetleyicisi (MVP)

Türkçe medikal rapor görüntülerini okuyan, ilgili SUT (Sağlık Uygulama Tebliği) parçalarını bulan ve her ilacın SGK geri ödeme koşullarına uyup uymadığını DeepSeek V3 üzerinden değerlendiren TypeScript tabanlı CLI aracıdır.

## Genel Bakış
- OpenAI Vision (varsayılan `gpt-4o-mini`) tüm PNG/JPG/JPEG/WEBP dosyalarını markdown metnine çevirir.
- Hafif rapor ayrıştırıcısı ICD kodlarını, hekim branşını ve ilaç satırlarını (form, doz, kullanım sıklığı) çıkarır.
- `pdf-parse`, `data/SUT.pdf` içindeki metni normalize eder, her ilaç için ±1000 karakterlik bağlam pencereleri döndürür.
- DeepSeek V3 tüm verileri JSON şemasına uygun, tamamen Türkçe açıklamalarla değerlendirir.

## Gereksinimler
- Node.js 20+ (ts-node çalıştırmak için).
- OpenAI (OCR) ve DeepSeek (karar aşaması) erişim anahtarları.
- En güncel `data/SUT.pdf` dosyasının repo içinde bulunması.

## Kurulum
```bash
npm install
```

## Ortam Değişkenleri (`.env`)
`.env` dosyası oluşturup aşağıdaki alanları doldurun (gerekirse `.env.example` içeriğini kopyalayın):

```ini
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL= # opsiyonel proxy
OPENAI_MODEL=gpt-4o-mini

DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com # opsiyonel
DEEPSEEK_MODEL=deepseek-chat
```

## Veri Hazırlığı
1. Güncel SUT belgesini `data/SUT.pdf` yoluna koyun. İlk çalıştırmada metin hafızaya alınır.
2. İşlenecek rapor görsellerini `./inputs` klasörüne bırakın (desteklenen uzantılar: `.png`, `.jpg`, `.jpeg`, `.webp`).
3. İsterseniz CLI komutuna farklı bir dizin argümanı (**ilk parametre**) vererek başka bir klasörü taratabilirsiniz.

## Çalıştırma
```bash
# varsayılan: ./inputs -> ./outputs
npx ts-node src/index.ts

# farklı klasör (./raporlarim yerine kendi klasör adınızı yazın)
npx ts-node src/index.ts ./raporlarim
```

Alternatif olarak `npm start` komutu `ts-node src/index.ts` çalıştırır; klasör yolunu ilk argüman olarak iletebilirsiniz.

## Üretilen Çıktılar
- `outputs/report.md` – her rapor için ICD/branş bilgileri ve ödenir/ödenmez tablosu içeren markdown.
- `outputs/raw_decisions.json` – DeepSeek’ten dönen ham JSON; denetim veya otomasyon için kullanılabilir.

## İş Akışı
1. **OCR** (`src/ocr.ts`): Görseli base64 olarak OpenAI’nin chat/vision API’sine gönderir, markdown metni döner.
2. **Ayrıştırma** (`src/parser.ts`): ICD kodları, hekim branşı ve ilaç satırlarını tablolar veya sezgisel ipuçlarıyla bulur.
3. **SUT Araması** (`src/sut_parser.ts`): PDF’i normalize eder ve her ilaç adı için konum ipuçlu metin parçaları üretir.
4. **Karar** (`src/llm.ts`): OCR metni + ayrıştırılmış meta + SUT bağlamını DeepSeek V3’e iletir, sıkı JSON şeması ister.
5. **Raporlama** (`src/index.ts`): Hem insan okuyabilir markdown’ı hem de ham JSON’u `outputs/` klasörüne yazar.

## İpuçları
- Hiç görsel bulunamazsa CLI uyarı basıp çıkar; dosya uzantılarını kontrol edin.
- DeepSeek bir rapordaki ilaçlar için boş liste dönerse CLI'dan hata fırlatılır; konsoldaki ham JSON çıktısını inceleyin.
- Eczacıların daha kısa/uzun açıklamalara ihtiyacı varsa `src/llm.ts` içindeki prompt metnini ayarlayabilirsiniz.
