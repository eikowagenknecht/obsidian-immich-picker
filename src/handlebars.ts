export interface HandlebarTemplate {
  local_thumbnail_link?: string;
  immich_url?: string;
  immich_asset_id?: string;
  original_filename?: string;
  taken_date?: string
}

export function handlebarParse (content: string, template: HandlebarTemplate) {
  for (const key of Object.keys(template) as Array<keyof HandlebarTemplate>) {
    content = content.replace(new RegExp(`\\{{\\s*${key}\\s*}\\}`, 'gi'), template[key] as string)
  }
  return content
}
