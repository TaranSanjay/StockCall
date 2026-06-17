import { supabase } from './supabase'

export async function logError(component, message, context = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('app_errors').insert({
      user_id:   user?.id ?? null,
      component,
      message:   String(message),
      context,
    })
  } catch (_) {
    // never throw from error logger
  }
}
