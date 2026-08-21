!macro customCheckAppRunning
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${if} ${isUpdated}
      StrCpy $R1 0
      update_wait:
        !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 != 0
          Goto update_ready
        ${endif}
        IntOp $R1 $R1 + 1
        ${if} $R1 >= 40
          nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
          Pop $R0
          Sleep 500
          Goto update_ready
        ${endif}
        Sleep 200
        Goto update_wait
      update_ready:
    ${else}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDCANCEL IDOK manual_stop
      Quit
      manual_stop:
        nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
        Pop $R0
        Sleep 500
    ${endif}
  ${endif}
!macroend
