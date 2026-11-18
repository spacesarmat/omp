# Магазины OMP (этап 1)

Стабильный релиз - тег `vX.Y.Z` или `desktop-X.Y.Z` без `-beta`. Бета магазины не обновляет.

Файлы релиза `v0.30.0` уже содержат установщик Windows, два DMG, AppImage и deb. Манифесты в этом репозитории собраны с их sha256. Следующий стабильный релиз переписывает их workflow `Stores`.

`Release` и `Desktop` после успешной публикации вызывают `gh workflow run stores.yml`. Если workflow еще нет на `main` или тег бета, шаг пишет notice и выходит 0. Падение магазина не красит релиз: `Stores` отдельный workflow.

Секреты в репозиторий не кладутся. Нет секрета или переменной - job пишет `::notice::` и пропускается.

## Что сделать вручную

| Канал | Секрет | Переменная | Первая отправка |
|---|---|---|---|
| winget | `WINGET_TOKEN` | `WINGET_LISTED=true` после принятия пакета | вручную, текст в `docs/stores/winget-initial.md` |
| Scoop | не нужен для каталога в этом репо | `SCOOP_BUCKET_TOKEN` и `SCOOP_BUCKET_REPO` только для отдельного bucket | не нужна, см. ниже |
| Homebrew | не нужен для cask в этом репо | `HOMEBREW_TAP_TOKEN` и `HOMEBREW_TAP_REPO` для отдельного tap | cask в homebrew-cask не найден, см. ниже |
| Flathub | `FLATHUB_TOKEN` | `FLATHUB_REPO` (база `master`) | вручную, файлы в `packaging/flatpak/` |
| Snap | `SNAPCRAFT_STORE_CREDENTIALS` | нет | аккаунт Snapcraft и имя `omp-player` |
| IzzyOnDroid | нет | нет | текст в `docs/stores/izzyondroid-request.md` |

`WINGET_TOKEN` - classic PAT с `public_repo` (и `workflow`, если форк сам подтягивает winget-pkgs). Fine-grained PAT winget-releaser не принимает. Форк `microsoft/winget-pkgs` должен быть у владельца токена.

`SNAPCRAFT_STORE_CREDENTIALS` - вывод `snapcraft export-login -`. Секрет создает аккаунт, который заведет Andy.

`HOMEBREW_TAP_TOKEN`, `SCOOP_BUCKET_TOKEN`, `FLATHUB_TOKEN` - classic PAT, который может пушить ветку `stores/vX.Y.Z` в указанный репозиторий и открывать туда PR. Пока переменная пустая, внешний push не делается.

## winget

Идентификатор `Spacesarmat.OMP`. Манифесты: `packaging/winget/manifests/s/Spacesarmat/OMP/0.30.0/`. Установщик - `OMP-<version>-setup.exe` (NSIS, тихий ключ `/S`, scope user: в `tauri.conf.json` нет `nsis.installMode`, у Tauri 2 это currentUser). Portable exe в пакет не входит.

Первый PR в `microsoft/winget-pkgs` готовится из этих файлов и отправляется только после слова Andy. Пока переменная `WINGET_LISTED` не равна `true`, CI не вызывает winget-releaser. После принятия пакета переменная включает обновление на каждом стабильном релизе (`vedantmgoyal9/winget-releaser`, коммит `b7370d4d`, regex `-setup\.exe$`).

## Scoop

`bucket/omp.json`. После вливания этого PR:

```
scoop bucket add omp https://github.com/spacesarmat/omp
scoop install omp
```

Scoop клонирует весь репозиторий. Отдельный маленький bucket задается `SCOOP_BUCKET_REPO` (ожидается `bucket/omp.json` в корне). `checkver` берет последний стабильный тег `vX.Y.Z`, `autoupdate` качает `OMP-$version-setup.exe`. Ярлык - `omp-desktop.exe`, удаление - `uninstall.exe /S` (шаблон NSIS Tauri).

CI на релизе открывает PR в этот репозиторий с новым hash. В `main` он попадает только после merge.

## Homebrew

Поиск 18.11.2026: публичный индекс `https://formulae.brew.sh/api/cask.json` (7838 cask) не содержит токена `omp` и не ссылается на `spacesarmat`. Отдельного tap в репозиториях spacesarmat нет. Cask, который обновляет CI, лежит здесь: `packaging/homebrew/Casks/omp.rb`.

Локальная проверка:

```
brew install --cask ./packaging/homebrew/Casks/omp.rb
```

В томе DMG приложение называется `OMP.app` (проверено на `OMP-0.30.0-macos-arm64.dmg`). Подписи Apple нет, в cask есть caveat. `livecheck` - `github_latest`, то есть тег GitHub Latest (`vX.Y.Z`), не бета.

Отдельный tap: репозиторий `homebrew-omp` с файлом `Casks/omp.rb` в корне, переменные `HOMEBREW_TAP_REPO` (например `spacesarmat/homebrew-omp`) и `HOMEBREW_TAP_TOKEN`. Заявка в `Homebrew/homebrew-cask` - тот же файл, вручную, когда Andy скажет.

## Flathub

`packaging/flatpak/com.spacesarmat.omp.desktop.yml` ставит deb из релиза в GNOME 47 runtime. Рядом desktop и metainfo. `x-checker-data` смотрит GitHub Latest, наш CI все равно переписывает url, sha256 и size.

Flathub держит отдельный репозиторий на приложение. Шаги:

1. Аккаунт и заявка на https://github.com/flathub/flathub (новый репозиторий `com.spacesarmat.omp.desktop`).
2. Положить в него три файла из `packaging/flatpak/` (имена в корне).
3. Сборка: `flatpak-builder` с рантаймом `org.gnome.Platform//47`. Бинарник собран на GitHub и линкуется с webkitgtk, в песочнице это может потребовать правок. Рецензент Flathub может попросить сборку из исходников. Этот манифест - пакет из релизного deb, как просили для этапа 1.
4. Когда репозиторий есть, `FLATHUB_REPO` и `FLATHUB_TOKEN`. CI пушит ветку `stores/<tag>` и открывает PR в `master`.

## Snap

`packaging/snap/snapcraft.yaml`, имя `omp-player` (имя `omp` в магазине свободно, но короткое имя часто отклоняют). Пакет - тот же deb, `core24`, strict, плагины сети и рабочего стола.

Имена `omp` и `omp-player` на 18.11.2026 отвечали 404 в API Snap Store.

Без `SNAPCRAFT_STORE_CREDENTIALS` job не ставит snapcraft и не собирает snap. С секретом: рендер yaml под тег, `snapcraft`, `snapcraft upload --release=stable`. Имя нужно зарегистрировать в аккаунте до первой загрузки.

## IzzyOnDroid

Пакет `com.spacesarmat.omp`. `versionCode` тот же, что в `android/app/build.gradle` и `src/lib/version.ts`: `major*1000000 + minor*10000 + patch*100 + slot`. Стабильный релиз - слот 99, бета N - слот N (не больше 98). Для 0.30.0 это `300099`.

Метаданные: `fastlane/metadata/android/en-US` и `ru-RU` (короткое и полное описание, заголовок, changelog по versionCode, иконка лаунчера, четыре снимка из `docs/screenshots/android-*.png`).

Имена APK на следующем стабильном релизе, рядом со старыми (их читает обновление в приложении и Homebrew Channel):

| Файл | ABI |
|---|---|
| `OMP-<version>-arm64-v8a.apk` | arm64-v8a |
| `OMP-<version>-armeabi-v7a.apk` | armeabi-v7a |
| `OMP-<version>-arm64.apk` | то же, что arm64-v8a, старое имя |
| `OMP-<version>-armv7.apk` | то же, что armeabi-v7a, старое имя |
| `OMP-<version>.apk` | universal |

У `v0.30.0` новых имен еще нет: релиз уже опубликован. Они появятся со следующего тега после вливания.

Текст заявки: `docs/stores/izzyondroid-request.md`. Размер arm64 APK `v0.30.0` - 58775886 байт, это выше ориентира 30 МБ. В заявке об этом сказано прямо.

## PR манифестов

Job `update` открывает PR `stores/<tag>` в этот репозиторий. В `main` файлы не коммитятся сами. Повторный запуск дописывает ту же ветку без force-push. Внешние PR (tap, bucket, Flathub) идут только если заданы их секрет и репозиторий.
