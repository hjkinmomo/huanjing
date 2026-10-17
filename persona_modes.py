"""Public edition: ordinary personas only; reject removed legacy mode requests."""
PREFIX='special.'

def role_mode(role_id):
    if str(role_id).startswith(PREFIX):raise ValueError('persona_mode_not_available_in_public_edition')
    return 'normal'

def base_role_id(role_id):
    role_mode(role_id)
    return role_id

def checked_mode(value='normal'):
    if value!='normal':raise ValueError('persona_mode_not_available_in_public_edition')
    return 'normal'
