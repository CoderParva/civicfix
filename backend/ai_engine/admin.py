from django.contrib import admin

from .models import AIAnalysis


@admin.register(AIAnalysis)
class AIAnalysisAdmin(admin.ModelAdmin):
    list_display = ("issue", "processing_status", "predicted_category", "confidence", "suggested_priority", "duplicate_score")
    list_filter = ("processing_status", "suggested_priority")
    readonly_fields = [f.name for f in AIAnalysis._meta.fields]

    def has_add_permission(self, request):
        return False
