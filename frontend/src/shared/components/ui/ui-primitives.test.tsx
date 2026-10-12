// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Checkbox } from './checkbox'
import { ConfirmDialog } from './confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu'
import { EmptyState } from './empty-state'
import { Field } from './field'
import { Input } from './input'
import { Select } from './select'
import { StatePill } from './state-pill'
import { Switch } from './switch'
import { Tooltip } from './tooltip'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

function render(ui: React.ReactNode) {
  act(() => root.render(ui))
}

describe('ConfirmDialog', () => {
  it('pune focusul pe „Anulează", nu pe acțiunea distructivă', () => {
    render(<ConfirmDialog open onOpenChange={() => {}} onConfirm={() => {}} title="Șterge clientul Acme SRL" confirmLabel="Șterge clientul" destructive />)
    expect(document.activeElement?.textContent).toBe('Anulează')
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Șterge clientul Acme SRL')
  })

  it('Esc închide fără să confirme', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(<ConfirmDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} title="Șterge" confirmLabel="Șterge" />)
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('butonul cu verbul confirmă și închide', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(<ConfirmDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} title="Șterge factura FV-2041" confirmLabel="Șterge factura" />)
    const confirmButton = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Șterge factura')
    act(() => confirmButton?.click())
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('Field', () => {
  it('leagă eticheta, eroarea și câmpul prin id', () => {
    render(
      <Field label="Sumă" optional error="Introdu suma în lei">
        <Input inputMode="decimal" />
      </Field>,
    )
    const input = container.querySelector('input')!
    const label = container.querySelector('label')!
    expect(label.htmlFor).toBe(input.id)
    expect(label.textContent).toBe('Sumă (opțional)')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Introdu suma în lei')
  })
})

describe('Select', () => {
  it('randează opțiunile și trimite valoarea aleasă', () => {
    const onValueChange = vi.fn()
    render(
      <Select
        aria-label="Monedă"
        value="RON"
        onValueChange={onValueChange}
        options={[
          { value: 'RON', label: 'Lei' },
          { value: 'EUR', label: 'Euro' },
        ]}
      />,
    )
    const select = container.querySelector('select')!
    expect(select.options).toHaveLength(2)
    act(() => {
      select.value = 'EUR'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onValueChange).toHaveBeenCalledWith('EUR')
  })
})

describe('EmptyState', () => {
  it('filtrul fără rezultate oferă resetarea, nu acțiunea de pornire', () => {
    const onReset = vi.fn()
    render(<EmptyState kind="filtered" title="Nicio factură restantă" onReset={onReset} action={<button>Factură nouă</button>} />)
    expect(container.textContent).not.toContain('Factură nouă')
    act(() => container.querySelector('button')?.click())
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('contul nou arată acțiunea de pornire', () => {
    render(<EmptyState kind="new" title="Nicio factură încă" action={<button>Factură nouă</button>} />)
    expect(container.textContent).toContain('Factură nouă')
  })
})

describe('DropdownMenu', () => {
  it('ține rândul triggerului în lățimea containerului, nu după conținut', () => {
    // `inline-block` își ia lățimea din conținut: fără `max-w-full` un rând cu nume + email
    // lățea câtul sidebar-ului (captura lui Stefan, sub „Temă: Luminos"). jsdom nu calculează
    // layout, deci verificăm clasa care fixează problema, nu lățimea randată.
    render(
      <DropdownMenu>
        <DropdownMenuTrigger className="truncate">ana.ivan@vanadium.systems</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => {}}>Profilul meu</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    expect(container.firstElementChild?.className).toContain('max-w-full')
  })
})

describe('StatePill', () => {
  it('poartă starea prin text, nu doar prin culoare', () => {
    render(<StatePill tone="critical">Restantă</StatePill>)
    expect(container.textContent).toBe('Restantă')
  })
})

describe('Switch', () => {
  it('doar două stări, anunțate prin role="switch"', () => {
    const onCheckedChange = vi.fn()
    render(<Switch checked onCheckedChange={onCheckedChange} label="Vede pagina" />)
    const control = container.querySelector('[role="switch"]') as HTMLButtonElement
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(control.getAttribute('aria-label')).toBe('Vede pagina')
    act(() => control.click())
    expect(onCheckedChange).toHaveBeenCalledWith(false)
  })

  it('nu reacționează când e dezactivat', () => {
    const onCheckedChange = vi.fn()
    render(<Switch checked disabled onCheckedChange={onCheckedChange} label="facturi.emitere" />)
    const control = container.querySelector('[role="switch"]') as HTMLButtonElement
    act(() => control.click())
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})

describe('Checkbox', () => {
  it('starea de pagină e nedeterminată, nu doar bifată', () => {
    const onChange = vi.fn()
    render(<Checkbox indeterminate aria-label="Facturi" onChange={onChange} />)
    const input = container.querySelector('input')!
    expect(input.getAttribute('aria-checked')).toBe('mixed')
    expect((input as HTMLInputElement).indeterminate).toBe(true)
    // Marcajul e decor: pe starea nedeterminată e o liniuță, nu o bifă.
    expect(container.querySelector('path')?.getAttribute('d')).toBe('M4 8h8')
    expect(input.checked).toBe(false)
  })

  it('bifat normal nu mai anunță „mixed"', () => {
    render(<Checkbox checked aria-label="sales@" onChange={() => {}} />)
    const input = container.querySelector('input')!
    expect(input.hasAttribute('aria-checked')).toBe(false)
    expect((input as HTMLInputElement).indeterminate).toBe(false)
  })
})

describe('Tooltip', () => {
  it('anvelopa ia focusul în locul butonului dezactivat și leagă motivul de el', () => {
    render(
      <Tooltip content="Nu ai Boți de trading, deci nu îi poți da">
        <Switch checked disabled onCheckedChange={() => {}} label="investitii.bots" />
      </Tooltip>,
    )
    const anchor = container.querySelector('.tooltip-anchor') as HTMLElement
    const control = container.querySelector('[role="switch"]') as HTMLButtonElement
    expect(anchor.tabIndex).toBe(0)
    expect(anchor.getAttribute('aria-describedby')).toBe(container.querySelector('[role="tooltip"]')!.id)
    // Motivul e legat de controlul dezactivat, deși acesta nu poate primi focus.
    expect(control.disabled).toBe(true)
    expect(container.querySelector('[role="tooltip"]')!.textContent).toBe('Nu ai Boți de trading, deci nu îi poți da')
  })

  it('nu adaugă un tab stop când controlul e activ — el primește focusul singur', () => {
    render(
      <Tooltip content="Pornește întâi «Vede pagina»">
        <Switch checked onCheckedChange={() => {}} label="facturi.emitere" />
      </Tooltip>,
    )
    expect((container.querySelector('.tooltip-anchor') as HTMLElement).tabIndex).toBe(-1)
  })
})
