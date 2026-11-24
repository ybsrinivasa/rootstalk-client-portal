'use client'

// Shared questions editor used by both the Campaign composer and the
// Touchpoint composer. Handles the 9 question types + choice-option
// validation + per-type unit/scale fields.

import { useState } from 'react'

export type QuestionType =
  | 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'YES_NO' | 'RATING_SCALE'
  | 'NUMBER' | 'SHORT_TEXT' | 'PARAGRAPH_TEXT' | 'DATE' | 'PHOTO_UPLOAD'

export interface Question {
  id: string
  sort_order: number
  question_type: QuestionType
  label: string
  help_text: string | null
  is_mandatory: boolean
  choice_options: string[] | null
  number_unit: string | null
  rating_scale_type: string | null
}

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  SINGLE_CHOICE: 'Single choice (pick one)',
  MULTIPLE_CHOICE: 'Multiple choice (pick many)',
  YES_NO: 'Yes / No',
  RATING_SCALE: 'Rating scale (1–5 stars)',
  NUMBER: 'Number with unit',
  SHORT_TEXT: 'Short text',
  PARAGRAPH_TEXT: 'Paragraph text',
  DATE: 'Date',
  PHOTO_UPLOAD: 'Photo upload',
}

export function QuestionsEditor({ questions, onAdd, onUpdate, onDelete, maxCount }: {
  questions: Question[]
  onAdd: (q: Omit<Question, 'id' | 'sort_order'>) => void
  onUpdate: (q: Question) => void
  onDelete: (id: string) => void
  maxCount: number
}) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Question | null>(null)

  function startNew() {
    setEditing(null); setShowForm(true)
  }
  function startEdit(q: Question) {
    setEditing(q); setShowForm(true)
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {questions.map((q, i) => (
          <li key={q.id} className="border border-slate-200 rounded-lg p-3 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">
                {i + 1}. {q.label} {q.is_mandatory && <span className="text-rose-500 text-xs">(required)</span>}
              </p>
              {q.help_text && <p className="text-xs text-slate-500 mt-0.5">{q.help_text}</p>}
              <p className="text-xs text-slate-400 mt-1">{QUESTION_TYPE_LABEL[q.question_type]}</p>
              {q.choice_options && q.choice_options.length > 0 && (
                <p className="text-xs text-slate-500 mt-1">Options: {q.choice_options.join(' · ')}</p>
              )}
              {q.number_unit && (
                <p className="text-xs text-slate-500 mt-1">Unit: {q.number_unit}</p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button" onClick={() => startEdit(q)}
                className="text-xs px-2 py-1 border border-slate-200 rounded text-slate-600 hover:bg-slate-50"
              >Edit</button>
              <button
                type="button" onClick={() => onDelete(q.id)}
                className="text-xs px-2 py-1 border border-rose-200 rounded text-rose-600 hover:bg-rose-50"
              >Remove</button>
            </div>
          </li>
        ))}
      </ol>
      {questions.length >= maxCount ? (
        <p className="text-xs text-slate-500 italic">Maximum of {maxCount} question{maxCount === 1 ? '' : 's'} reached.</p>
      ) : (
        <button
          type="button" onClick={startNew}
          className="text-sm px-4 py-2 rounded-lg border-2 border-dashed border-slate-300 text-slate-600 hover:border-slate-400 w-full"
        >
          + Add question
        </button>
      )}
      {showForm && (
        <QuestionFormModal
          initial={editing}
          onCancel={() => setShowForm(false)}
          onSave={(payload) => {
            if (editing) {
              onUpdate({ ...editing, ...payload })
            } else {
              onAdd(payload)
            }
            setShowForm(false)
          }}
        />
      )}
    </div>
  )
}

function QuestionFormModal({ initial, onCancel, onSave }: {
  initial: Question | null
  onCancel: () => void
  onSave: (q: Omit<Question, 'id' | 'sort_order'>) => void
}) {
  const [qt, setQt] = useState<QuestionType>(initial?.question_type ?? 'SHORT_TEXT')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [helpText, setHelpText] = useState(initial?.help_text ?? '')
  const [mandatory, setMandatory] = useState(initial?.is_mandatory ?? false)
  const [choiceOptions, setChoiceOptions] = useState<string[]>(initial?.choice_options ?? ['', ''])
  const [numberUnit, setNumberUnit] = useState(initial?.number_unit ?? '')

  function updateOption(i: number, v: string) {
    setChoiceOptions(opts => opts.map((o, idx) => idx === i ? v : o))
  }
  function addOption() {
    if (choiceOptions.length < 10) setChoiceOptions(opts => [...opts, ''])
  }
  function removeOption(i: number) {
    if (choiceOptions.length > 2) setChoiceOptions(opts => opts.filter((_, idx) => idx !== i))
  }

  function handleSave() {
    const needsChoices = qt === 'SINGLE_CHOICE' || qt === 'MULTIPLE_CHOICE'
    const cleaned = choiceOptions.map(o => o.trim()).filter(Boolean)
    if (needsChoices && cleaned.length < 2) {
      alert('Add at least 2 options.')
      return
    }
    if (qt === 'NUMBER' && !numberUnit.trim()) {
      alert('Enter a unit (e.g. quintals, kg, Rs.)')
      return
    }
    onSave({
      question_type: qt,
      label: label.trim() || '(untitled)',
      help_text: helpText.trim() || null,
      is_mandatory: mandatory,
      choice_options: needsChoices ? cleaned : null,
      number_unit: qt === 'NUMBER' ? numberUnit.trim() : null,
      rating_scale_type: qt === 'RATING_SCALE' ? 'STAR_5' : null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto shadow-xl">
        <header className="p-5 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-900">
            {initial ? 'Edit question' : 'New question'}
          </h3>
        </header>
        <div className="p-5 space-y-3">
          <label className="block text-sm">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Question type</span>
            <select
              value={qt} onChange={e => setQt(e.target.value as QuestionType)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
            >
              {Object.keys(QUESTION_TYPE_LABEL).map(k => (
                <option key={k} value={k}>{QUESTION_TYPE_LABEL[k as QuestionType]}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Question text</span>
            <input
              type="text" value={label} onChange={e => setLabel(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
              maxLength={500}
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Help text (optional)</span>
            <input
              type="text" value={helpText} onChange={e => setHelpText(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
              maxLength={500}
            />
          </label>
          {(qt === 'SINGLE_CHOICE' || qt === 'MULTIPLE_CHOICE') && (
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider">Options (2–10)</p>
              <div className="space-y-2 mt-1">
                {choiceOptions.map((opt, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text" value={opt}
                      onChange={e => updateOption(i, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                    {choiceOptions.length > 2 && (
                      <button
                        type="button" onClick={() => removeOption(i)}
                        className="text-xs text-rose-500 hover:text-rose-700 px-2"
                      >×</button>
                    )}
                  </div>
                ))}
              </div>
              {choiceOptions.length < 10 && (
                <button
                  type="button" onClick={addOption}
                  className="text-xs text-blue-600 hover:text-blue-800 mt-2"
                >+ Add option</button>
              )}
            </div>
          )}
          {qt === 'NUMBER' && (
            <label className="block text-sm">
              <span className="text-xs text-slate-500 uppercase tracking-wider">Unit</span>
              <input
                type="text" value={numberUnit} onChange={e => setNumberUnit(e.target.value)}
                placeholder="e.g. quintals, kg, Rs."
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox" checked={mandatory}
              onChange={e => setMandatory(e.target.checked)}
            />
            <span>Recipient must answer this question to submit</span>
          </label>
        </div>
        <footer className="p-5 border-t border-slate-100 flex justify-end gap-2">
          <button
            type="button" onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
          >Cancel</button>
          <button
            type="button" onClick={handleSave}
            disabled={!label.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >Save</button>
        </footer>
      </div>
    </div>
  )
}
