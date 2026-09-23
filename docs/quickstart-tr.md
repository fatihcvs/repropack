# Türkçe başlangıç rehberi

ReproPack, bir Node.js hatası için seçtiğiniz dosyaları paketler, bütünlüklerini
kontrol eder ve aynı hatayı iki temiz çalışma dizininde arar. Bu sürüm geliştirme
önizlemesidir; Claude skill'inin davranış doğrulaması ve karşılaştırmalı
değerlendirmesi henüz tamamlanmadı.

Node.js 22 veya daha yenisini kurup bu depoyu klonlayın. Aşağıdaki komutları depo
kökünde çalıştırın. CLI için `npm install` gerekmez. Windows'ta Windows PowerShell
ve .NET; Linux'ta util-linux `unshare` ve kullanıcı/PID/mount namespace oluşturma
izni gerekir. macOS çalıştırma desteği doğrulanmadı.

Önce `fixtures/assertion/bug.cjs` dosyasını okuyun. Ağ veya bağımlılık kullanmayan,
ürün miktarını hesaba katmayan kasıtlı bir örnektir. Depo kökünde `recipe.json`
oluşturun:

```json
{
  "root": "fixtures/assertion",
  "output": "../repropack-assertion-package",
  "files": ["bug.cjs"],
  "command": ["node", "bug.cjs"],
  "signature": "TOTAL_IGNORES_QUANTITY",
  "exitCode": 1,
  "timeoutMs": 10000
}
```

Çıktı dizini mevcut olmamalıdır. Zaten varsa yeni bir ad seçin; önceki kanıtı
silmeyin. Tarifin yolları JSON dosyasının konumuna göre değil, komutu çalıştırdığınız
dizine göre çözümlenir.

```sh
node src/cli.js create recipe.json
node src/cli.js verify ../repropack-assertion-package
node src/cli.js run ../repropack-assertion-package --allow-execution > result.json
node src/cli.js report result.json > report.md
```

Çıktıyı UTF-8 kaydedin. PowerShell 7 veya POSIX kabuğundaki yönlendirme uygundur.
Windows PowerShell 5 kullanıyorsanız son iki komutun yerine şunları çalıştırın:

```powershell
$runOutput = node src/cli.js run ../repropack-assertion-package --allow-execution
[IO.File]::WriteAllLines((Join-Path $PWD 'result.json'), $runOutput, [Text.UTF8Encoding]::new($false))
$reportOutput = node src/cli.js report result.json
[IO.File]::WriteAllLines((Join-Path $PWD 'report.md'), $reportOutput, [Text.UTF8Encoding]::new($false))
```

`create`, `packaged`; `verify`, `verified` ve `execution: not_run` bildirmelidir.
Paketteki dosyayı ve tarifi çalıştırmadan önce inceleyin. `--allow-execution`,
seçilen kodu sizin işletim sistemi izinlerinizle çalıştırır. Ayrı dizinler ve alt
süreçlerin sonlandırılması güvenlik sandbox'ı sağlamaz.

Beklenen sonuç `reproduced`: iki denemede de hedef komut 1 koduyla çıkmalı ve
`TOTAL_IGNORES_QUANTITY` yazmalıdır. Beklenen hata eşleştiğinde CLI'nin kendi çıkış
kodu 0 olur. Rapor; komutu, ortamı, dosya özetini ve gerçek çıktıyı gösterir.
Hata düzeltilmez ve kök nedeni kanıtlanmış sayılmaz. Yardımcı süreç başlatılamazsa
veya namespace izni yoksa bu, örnekte aranan hata değildir.

Kendi projenizde yalnızca gerekli dosyaları seçin. npm bağımlılıkları için
`package.json` ve `package-lock.json` ekleyin. İsteğe bağlı
`["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]` hazırlık komutu
ağ kullanabilir; komutu önceden inceleyin ve yeterli zaman aşımı süresi verin.
Başarısız kurulum, uygulama hatasının tekrar üretildiği anlamına gelmez.

Paylaşmadan önce bütün dosyaları ve çıktıları kontrol edin. Yaygın kimlik bilgisi
dosya adları engellenir; kaynak koda veya loglara gömülü sırlar otomatik bulunmaz.
`report --mask-path`, verilen yolların düz metin eşleşmelerini yalnızca raporda
maskeler; asıl kanıtı değiştirmez. Otomatik yükleme veya GitHub paylaşımı yapılmaz.

Taslak skill için [kurulum yönergelerine](skill-installation.md) bakın. CLI'nin
başarılı çalışması, Claude'un skill'i yükleyip doğru kullandığını kanıtlamaz.
