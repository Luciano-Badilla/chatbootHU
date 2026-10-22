<?php

namespace App\Support;

use DOMDocument;
use DOMElement;
use DOMNode;

class EmailHtmlSanitizer
{
    private const ALLOWED_TAGS = [
        'a', 'b', 'blockquote', 'br', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'i', 'li', 'ol', 'p', 'span', 'strong', 'u', 'ul',
        'table', 'tbody', 'td', 'th', 'thead', 'tr',
    ];

    private const DROP_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'math', 'img', 'video', 'audio', 'link', 'meta'];

    public function sanitize(string $html): string
    {
        if (trim($html) === '' || ! class_exists(DOMDocument::class)) {
            return '';
        }

        $document = new DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);

        try {
            $document->loadHTML(
                '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="email-root">'.$html.'</div></body></html>',
                LIBXML_HTML_NODEFDTD | LIBXML_NONET,
            );

            $root = null;
            foreach ($document->getElementsByTagName('div') as $element) {
                if ($element instanceof DOMElement && $element->getAttribute('id') === 'email-root') {
                    $root = $element;
                    break;
                }
            }
            if (! $root) {
                return '';
            }

            $this->sanitizeChildren($root);

            $output = '';
            foreach ($root->childNodes as $child) {
                $output .= $document->saveHTML($child);
            }

            return trim($output);
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    private function sanitizeChildren(DOMNode $parent): void
    {
        foreach (iterator_to_array($parent->childNodes) as $child) {
            if (! $child instanceof DOMElement) {
                continue;
            }

            $tag = strtolower($child->tagName);
            if (in_array($tag, self::DROP_TAGS, true)) {
                $child->parentNode?->removeChild($child);

                continue;
            }

            if (! in_array($tag, self::ALLOWED_TAGS, true)) {
                $this->sanitizeChildren($child);
                while ($child->firstChild) {
                    $child->parentNode?->insertBefore($child->firstChild, $child);
                }
                $child->parentNode?->removeChild($child);

                continue;
            }

            $this->sanitizeAttributes($child, $tag);
            $this->sanitizeChildren($child);
        }
    }

    private function sanitizeAttributes(DOMElement $element, string $tag): void
    {
        foreach (iterator_to_array($element->attributes) as $attribute) {
            $name = strtolower($attribute->name);
            if ($name === 'style') {
                $safeStyle = $this->sanitizeStyle($attribute->value);
                if ($safeStyle === '') {
                    $element->removeAttribute($attribute->name);
                } else {
                    $element->setAttribute('style', $safeStyle);
                }

                continue;
            }

            if ($tag === 'a' && $name === 'href' && $this->isSafeHref($attribute->value)) {
                continue;
            }

            if ($name === 'title' || ($tag === 'td' || $tag === 'th') && in_array($name, ['colspan', 'rowspan'], true)) {
                continue;
            }

            $element->removeAttribute($attribute->name);
        }
    }

    private function isSafeHref(string $href): bool
    {
        $href = trim($href);

        if (preg_match('/^(https?:\/\/|mailto:|tel:)/i', $href) !== 1) {
            return false;
        }

        return ! preg_match('/[\x00-\x20]/', $href);
    }

    private function sanitizeStyle(string $style): string
    {
        $safe = [];

        foreach (explode(';', $style) as $declaration) {
            if (! str_contains($declaration, ':')) {
                continue;
            }

            [$property, $value] = array_map('trim', explode(':', $declaration, 2));
            $property = strtolower($property);
            $value = strtolower($value);

            if (str_contains($value, 'url(') || str_contains($value, 'expression') || preg_match('/[<>\\\\]/', $value)) {
                continue;
            }

            $valid = match ($property) {
                'text-align' => in_array($value, ['left', 'center', 'right', 'justify'], true),
                'font-weight' => in_array($value, ['normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900'], true),
                'font-style' => in_array($value, ['normal', 'italic'], true),
                'text-decoration' => in_array($value, ['none', 'underline', 'line-through'], true),
                'color', 'background-color' => preg_match('/^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([0-9.,% ]+\))$/', $value) === 1,
                'font-size' => preg_match('/^[0-9]{1,2}(px|pt|em|%)$/', $value) === 1,
                'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left' => preg_match('/^[0-9.]+(px|pt|em|%)?( [0-9.]+(px|pt|em|%)?){0,3}$/', $value) === 1,
                default => false,
            };

            if ($valid) {
                $safe[] = $property.': '.$value;
            }
        }

        return implode('; ', $safe);
    }
}
