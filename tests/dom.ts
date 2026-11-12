// Installe un faux navigateur (happy-dom) pour les tests d'interface.
// Doit être importé AVANT React et Testing Library.
import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register()
// Indique à React qu'il tourne dans un environnement de test.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
