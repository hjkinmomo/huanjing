"""Current public city wording, with stable IDs and legacy search aliases."""
def canonical_city_value(value):
    if isinstance(value,str):return value.replace('澄湾','夏城')
    if isinstance(value,list):return [canonical_city_value(v) for v in value]
    if isinstance(value,dict):
        result={k:(v if k in ('id','parentId','exits','aliases','src','url','address') else canonical_city_value(v)) for k,v in value.items()}
        old=value.get('name')
        if isinstance(old,str) and old!=result.get('name') and isinstance(value.get('aliases'),list):
            result['aliases']=list(value['aliases'])
            if old not in result['aliases'] and len(result['aliases'])<64:result['aliases'].append(old)
        return result
    return value
