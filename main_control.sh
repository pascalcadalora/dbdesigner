#!/usr/bin/env bash
set -u
SCHEMA_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCHEMA_ROOT" || exit 1
if [[ $# -gt 0 ]]; then exec node scripts/control.mjs "$@"; fi
while true; do
    printf '\nSCHEMA STUDIO - MAIN CONTROL\n  4. Deploy / redeploy API + frontend\n  7. Status\n  9. Open aplikasi\n 10. Install dependencies\n 11. Run checks\n 15. Stop aplikasi\n  0. Exit\n'
    read -r -p 'Pilih: ' schema_choice || exit 0
    case "$schema_choice" in
        4) node scripts/control.mjs deploy ;;
        7) node scripts/control.mjs status ;;
        9) if command -v xdg-open >/dev/null 2>&1; then xdg-open http://127.0.0.1:3080; else printf 'Buka http://127.0.0.1:3080\n'; fi ;;
        10) node scripts/control.mjs install ;;
        11) node scripts/control.mjs check ;;
        15) node scripts/control.mjs stop ;;
        0) exit 0 ;;
        *) printf 'Pilihan tidak valid.\n' ;;
    esac
done
