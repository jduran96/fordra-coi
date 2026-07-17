'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { C } from '@/lib/theme'

/**
 * Minimal rich-text field (bold / italic / underline / bulleted and numbered
 * lists) for the contact note Summary. Bridges Tiptap into a plain
 * <form action>: the HTML rides in a hidden input, and the parent owns the
 * value so a failed save keeps the typed summary (same persist-on-error
 * contract as the other note fields). Everything beyond b/i/u/ul/ol
 * paragraphs is disabled here AND stripped again server-side by
 * sanitizeSummaryHtml before storage.
 */
export default function RichTextInput({ name, value, onChange }: {
  name: string
  value: string
  onChange: (html: string) => void
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false, codeBlock: false, code: false, strike: false,
        horizontalRule: false, link: false,
      }),
    ],
    content: value,
    // Required under SSR frameworks: render only after hydration.
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? '' : editor.getHTML()),
  })

  const btn = (active: boolean) => ({
    width: 30, height: 26, padding: 0, fontSize: 12.5, fontFamily: C.sans,
    borderRadius: 6, cursor: 'pointer', lineHeight: 1,
    border: `1px solid ${active ? C.txt : C.border}`,
    background: active ? C.txt : C.surface,
    color: active ? C.onDark : C.txt2,
  })

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 7, background: C.surface }}>
      <input type="hidden" name={name} value={value} />
      <div style={{ display: 'flex', gap: 4, padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
        <button type="button" aria-label="Bold" onClick={() => editor?.chain().focus().toggleBold().run()}
          style={{ ...btn(!!editor?.isActive('bold')), fontWeight: 700 }}>B</button>
        <button type="button" aria-label="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()}
          style={{ ...btn(!!editor?.isActive('italic')), fontStyle: 'italic' }}>I</button>
        <button type="button" aria-label="Underline" onClick={() => editor?.chain().focus().toggleUnderline().run()}
          style={{ ...btn(!!editor?.isActive('underline')), textDecoration: 'underline' }}>U</button>
        <span style={{ width: 1, alignSelf: 'stretch', background: C.border, margin: '0 3px' }} />
        <button type="button" aria-label="Bulleted list" onClick={() => editor?.chain().focus().toggleBulletList().run()}
          style={{ ...btn(!!editor?.isActive('bulletList')), fontSize: 15 }}>•</button>
        <button type="button" aria-label="Numbered list" onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          style={btn(!!editor?.isActive('orderedList'))}>1.</button>
      </div>
      <style>{`
        .fordra-rte .tiptap { min-height: 96px; padding: 9px 11px; font-size: 14px; font-family: inherit; color: ${C.txt}; line-height: 1.6; outline: none; }
        .fordra-rte .tiptap p { margin: 0 0 6px; }
        .fordra-rte .tiptap p:last-child { margin-bottom: 0; }
        .fordra-rte .tiptap ul, .fordra-rte .tiptap ol { margin: 0 0 6px; padding-left: 22px; }
        .fordra-rte .tiptap li p { margin: 0; }
      `}</style>
      <div className="fordra-rte" style={{ fontFamily: C.sans, cursor: 'text' }}
        onClick={() => editor?.chain().focus().run()}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
