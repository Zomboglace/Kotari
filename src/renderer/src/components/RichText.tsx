import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type * as Y from 'yjs'

interface Props {
  fragment: Y.XmlFragment
  /** Fournisseur Hocuspocus : présent pour un document du serveur (curseurs). */
  provider: unknown | null
  user: { name: string; color: string } | null
  placeholder?: string
  compact?: boolean
}

export function RichText({ fragment, provider, user, compact }: Props) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false, link: { openOnClick: false } }),
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

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            strike: e.isActive('strike'),
            h2: e.isActive('heading', { level: 2 }),
            h3: e.isActive('heading', { level: 3 }),
            ul: e.isActive('bulletList'),
            ol: e.isActive('orderedList'),
            quote: e.isActive('blockquote')
          }
        : null
  })

  if (!editor) return null
  const chain = () => editor.chain().focus()
  const btn = (label: string, title: string, active: boolean | undefined, run: () => void, cls = '') => (
    <button
      type="button"
      className={`tb ${active ? 'on' : ''} ${cls}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  )

  return (
    <div className={`richtext ${compact ? 'compact' : ''}`}>
      <div className="toolbar">
        {btn('G', 'Gras (Ctrl+B)', s?.bold, () => chain().toggleBold().run(), 'b')}
        {btn('I', 'Italique (Ctrl+I)', s?.italic, () => chain().toggleItalic().run(), 'i')}
        {btn('S', 'Barré', s?.strike, () => chain().toggleStrike().run(), 's')}
        <span className="tb-sep" />
        {btn('T1', 'Titre', s?.h2, () => chain().toggleHeading({ level: 2 }).run())}
        {btn('T2', 'Sous-titre', s?.h3, () => chain().toggleHeading({ level: 3 }).run())}
        <span className="tb-sep" />
        {btn('•', 'Liste à puces', s?.ul, () => chain().toggleBulletList().run())}
        {btn('1.', 'Liste numérotée', s?.ol, () => chain().toggleOrderedList().run())}
        {btn('❝', 'Citation', s?.quote, () => chain().toggleBlockquote().run())}
        <span className="tb-sep" />
        {btn('↶', 'Annuler (Ctrl+Z)', false, () => chain().undo().run())}
        {btn('↷', 'Rétablir (Ctrl+Y)', false, () => chain().redo().run())}
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
