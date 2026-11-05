; Spoon's Windows setup wizard: its own words on the standard pages (Welcome, Choose folder,
; Installing, Finished), with the wizard-and-spoon pictures (build/installer/*.bmp).

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Spoon"
  !define MUI_WELCOMEPAGE_TEXT "Spoon is a friendly git client: your branches, changes and history, all in one window.$\r$\n$\r$\nThis wizard puts Spoon on this computer in about a minute. Installing it just for you needs no administrator rights, and it never touches your projects.$\r$\n$\r$\nFound a fork in your toolbox? Time to put it down. Click Next."
  !insertmacro MUI_PAGE_WELCOME
  ; The next page with a header is choosing the folder.
  !define MUI_PAGE_HEADER_TEXT "Where should Spoon live?"
  !define MUI_PAGE_HEADER_SUBTEXT "The usual place is fine for almost everyone."
  !define MUI_DIRECTORYPAGE_TEXT_TOP "Spoon installs just for you, in your own user folder. To put it somewhere else, choose another folder; your settings and projects stay where they are either way."
!macroend

!macro customPageAfterChangeDir
  ; Said on the page that shows the copying.
  !define MUI_PAGE_HEADER_TEXT "Stirring in the ingredients…"
  !define MUI_PAGE_HEADER_SUBTEXT "Copying Spoon into place. This only takes a moment."
  !define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "All mixed in"
  !define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Spoon is installed."
!macroend

; The last page (electron-builder adds the "Run Spoon" box to it).
!define MUI_FINISHPAGE_TITLE "Spoon is ready"
!define MUI_FINISHPAGE_TEXT "Spoon is on your computer, with shortcuts on the desktop and in the Start menu.$\r$\n$\r$\nThe first time it opens, a short tour shows what you can make your own: colors, sizes, how diffs and history look, and your GitHub and SSH setup. You can skip it at any time.$\r$\n$\r$\nSpoon keeps itself up to date from then on."
!define MUI_FINISHPAGE_RUN_TEXT "Open Spoon now"
