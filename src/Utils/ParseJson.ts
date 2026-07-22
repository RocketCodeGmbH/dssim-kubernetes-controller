
export const parseJSON = (
    rawSelector: string | undefined
): Record<string, string> | undefined => {
    const trimmed = rawSelector?.trim();
    if (!trimmed) {
        return undefined;
    }

    return JSON.parse(trimmed) as Record<string, string>;
};
