import { useState, type Dispatch, type SetStateAction } from 'react'

/**
 * Dialog state that keeps its data while the close animation runs:
 *   const mp = useDialog<string>()
 *   mp.show('mp0') … <MountPointDialog {...mp.props} target={mp.data} />
 */
export function useDialog<T = true>() {
  const [state, setState] = useState<{ data: T; open: boolean } | null>(null)
  return {
    data: state?.data,
    open: !!state?.open,
    show: (data: T) => setState({ data, open: true }),
    props: {
      open: !!state?.open,
      onOpenChange: (open: boolean) => setState((s) => (s ? { ...s, open } : s)),
    },
  }
}

/** Form state re-initialised from `init` each time the dialog opens. */
export function useFormState<T>(open: boolean, init: () => T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(init)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setState(init())
  }
  return [state, setState]
}

/** Thrown by onSubmit when client-side validation fails (FormDialog shows the message). */
export class ValidationError extends Error {
  constructor(message = '请先修正标出的问题') {
    super(message)
    this.name = 'ValidationError'
  }
}
