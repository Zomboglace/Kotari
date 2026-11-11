import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { Placeholder } from '@tiptap/extensions'
import type * as Y from 'yjs'
import { fold } from '@shared/search'
import { flash, registerFocus } from '../lib/focus'

interface Props {
  fragment: Y.XmlFragment
  /** Fournisseur Hocuspocus : présent pour un document du serveur (curseurs). */
  provider: unknown | null
  user: { name: string; color: string } | null
  focusKey?: string
  compact?: boolean
}

// Pas de barre d'outils : la mise en forme se fait au clavier, façon Markdown
// (# titre, **gras**, *italique*, - liste, 1. liste, > citation) ou Ctrl+B / Ctrl+I.
export function RichText({ fragment, provider, user, focusKey, compact }: Props) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false, link: { openOnClick: false } }),
        Placeholder.configure({ placeholder: compact ? '…' : 'Écris ici…' }),
        Collaboration.configure({ fragment }),
        ...(provider && user
          ? [
              CollaborationCaret.configure({
                provider,
                user,
                render: (u) => {
                  const caret = document.createElement('span')
                  caret.className = 'remote-caret'
                  caret.style.borderColor = u.color
                  const label = document.createElement('span')
                  label.className = 'remote-caret-label'
                  label.style.background = u.color
                  label.textContent = u.name
                  caret.append(label)
                  return caret
                }
              })
            ]
          : [])
      ],
      editorProps: { attributes: { class: 'prose', spellcheck: 'true' } }
    },
    [fragment, provider]
  )

  // Recherche : sélectionne la n-ième occurrence (cherchée bloc par bloc, comme l'index).
  useEffect(() => {
    if (!editor || !focusKey) return
    return registerFocus(focusKey, (query, nth) => {
      const q = fold(query.trim())
      if (!q || editor.isDestroyed) return false
      let count = 0
      let found: { from: number; to: number } | null = null
      editor.state.doc.descendants((node, pos) => {
        if (found) return false
        if (!node.isTextblock) return true
        // Texte du bloc et position de chaque caractère dans le document.
        let text = ''
        const map: number[] = []
        node.forEach((child, offset) => {
          if (child.isText && child.text) {
            for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i)
            text += child.text
          }
        })
        const t = fold(text)
        let i = t.indexOf(q)
        while (i !== -1) {
          if (count === nth) {
            found = { from: map[i], to: map[i + q.length - 1] + 1 }
            return false
          }
          count++
          i = t.indexOf(q, i + q.length)
        }
        return false
      })
      if (!found) return false
      editor.chain().focus().setTextSelection(found).scrollIntoView().run()
      flash(editor.view.dom)
      return true
    })
  }, [editor, focusKey])

  if (!editor) return null
  return (
    <div className={`richtext ${compact ? 'compact' : ''}`}>
      <EditorContent editor={editor} />
    </div>
  )
}
