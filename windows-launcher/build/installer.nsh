!include MUI2.nsh
!include LogicLib.nsh
!include nsDialogs.nsh

Var AUTOSTART_CHECKBOX

Page custom CustomAutostartPage

Function CustomAutostartPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 10u 10u 100% 12u "Would you like Mana to start automatically when you log in?"
  Pop $R0
  ${NSD_CreateCheckbox} 10u 30u 100% 12u "Launch Mana at login"
  Pop $AUTOSTART_CHECKBOX

  nsDialogs::Show
FunctionEnd

Function .onInstSuccess
  ${NSD_GetState} $AUTOSTART_CHECKBOX $R0
  StrCmp $R0 1 +2
    Goto done
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Mana" '"$INSTDIR\Mana.exe"'
done:
FunctionEnd

Function un.onUninstSuccess
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Mana"
FunctionEnd
