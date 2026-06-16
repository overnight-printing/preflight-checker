import os
import re

replacements = {
    "스탬프 활성화": "Enable Union Bug",
    "모든 프리플라이트 수정 및 크롭을 취소하고 원본 파일로 되돌립니다.": "Reset to original artwork",
    "🔄 아트워크 초기화": "🔄 Reset Artwork",
    "유니언버그 인쇄 적용": "Apply Union Bug",
    "퀵 정렬 도구": "Quick Align",
    "좌측 정렬": "Align Left",
    "가운데 정렬": "Align Center",
    "우측 정렬": "Align Right",
    r"<p[^>]*>\s*\* 클릭 시 안전 마진 내 하단 영역에 칼같이 정렬 배치됩니다\.\s*</p>": "",
    "버그 크기 조절": "Bug Size",
    "크기 비율": "Scale",
    "버그 색상 변환": "Bug Color",
    "대비 자동": "Auto Contrast",
    "팔레트": "Palette",
    "커스텀": "Custom",
    "현재 배치 영역의 배경색 대조 대비에 따라 <strong>블랙</strong> 또는 <strong>화이트</strong>로 자동 최적화됩니다.": "Auto-optimized to Black or White based on background.",
    "추천 색상 팔레트": "Recommended Palette",
    "출력 여백 설정": "Margin Settings",
    "0.125인치 미러 블리드 추가": "Add 0.125\" Mirror Bleed",
    "재단선 기준으로 자르기": "Crop to Trim Box",
    r"<p[^>]*>크랍마크 제거 및 정사이즈 크롭</p>": "",
    "여백 추가 커트 \(Manual\)": "Manual Crop",
    "안전 영역 가이드": "Safe Zone Guide",
    "스탬프 적용 페이지": "Apply Pages",
    "현재 페이지만 적용": "Current Page Only",
    "모든 페이지에 적용": "All Pages",
    "마지막 페이지에만 적용": "Last Page Only",
    "첫 번째 페이지에만 적용": "First Page Only",
    "PDF 전용 기능": "PDF Only",
    "프리플라이트 검사는 PDF 문서에 최적화되어 있습니다. 이미지 파일은 검사를 진행할 수 없습니다. PDF 아트워크를 업로드해 주세요.": "Preflight is only supported for PDF files. Please upload a PDF.",
    "PDF 파일 규격 정밀 분석 중...": "Analyzing PDF...",
    "미러 도련 추가": "Add Mirror Bleed",
    "오버프린트 제거": "Remove Overprint",
    "폰트 아웃라인 변환": "Outline Fonts",
    "CMYK로 변환": "Convert to CMYK",
    "빈 페이지 제거": "Remove Blank Pages",
    "레이어 병합": "Flatten Layers",
    "자동 수정": "Auto Fix",
    "인쇄 적합성 검사 요약": "Preflight Summary",
    "패스": "Pass",
    "경고": "Warning",
    "오류 \(수정가능\)": "Error (Fixable)",
    "인쇄 적합성 검사항목 \(Preflight Checks\)": "Preflight Checks",
    "이미지 해상도 \(Image Resolution\)": "Image Resolution",
    "도련 여백 설정 \(Bleed\)": "Bleed Margin",
    "축소": "Zoom Out",
    "확대": "Zoom In",
    "화면에 맞춤": "Fit to Screen",
    "이전 페이지": "Prev",
    "다음 페이지": "Next",
    "페이지 이동": "Go to Page",
    "아트워크 파일을 읽는 중 오류가 발생했습니다.": "Error loading artwork file.",
    "초기화 중 오류가 발생했습니다.": "Error resetting artwork.",
    "유니언버그 PDF 파일을 읽는 중 오류가 발생했습니다.": "Error loading Union Bug PDF.",
    "오류를 해결하는 중 문제가 발생했습니다: ": "Error fixing issue: ",
    "알 수 없는 오류": "Unknown error"
}

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    new_content = content
    for k, v in replacements.items():
        if k.startswith('<p'): # regex mode
            new_content = re.sub(k, v, new_content)
        else:
            new_content = new_content.replace(k, v)
            
    if content != new_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated {filepath}")

for root, dirs, files in os.walk('src'):
    for file in files:
        if file.endswith(('.js', '.jsx', '.html')):
            process_file(os.path.join(root, file))

