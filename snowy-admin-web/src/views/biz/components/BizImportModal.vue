<template>
	<a-modal
		v-model:open="visible"
		:title="title"
		:width="640"
		:footer="null"
		:destroy-on-close="true"
		@cancel="onClose"
	>
		<a-space direction="vertical" style="width: 100%" :size="14">
			<a-alert
				type="info"
				show-icon
				message="支持 .xlsx / .xls 文件；可先执行“预演校验”确认无误后再“正式导入”"
			/>
			<div style="display: flex; justify-content: space-between; align-items: center">
				<a-upload :before-upload="beforeUpload" :file-list="fileList" :max-count="1" accept=".xlsx,.xls" @remove="onRemoveFile">
					<a-button>
						<template #icon><UploadOutlined /></template>
						选择 Excel 文件
					</a-button>
				</a-upload>
				<a-button type="link" @click="handleDownloadTemplate">
					<template #icon><DownloadOutlined /></template>
					下载导入模板
				</a-button>
			</div>

			<a-space>
				<a-button :disabled="fileList.length === 0" :loading="submitting" @click="doImport(true)">
					预演校验 (dryRun)
				</a-button>
				<a-button type="primary" :disabled="fileList.length === 0" :loading="submitting" @click="doImport(false)">
					确认正式导入
				</a-button>
			</a-space>

			<div v-if="importResult">
				<a-descriptions size="small" bordered :column="3">
					<a-descriptions-item label="模式">{{ importResult.dryRun ? '预演校验' : '正式导入' }}</a-descriptions-item>
					<a-descriptions-item label="总行数">{{ importResult.total }}</a-descriptions-item>
					<a-descriptions-item label="成功 / 失败">
						<span style="color: #52c41a">{{ importResult.success }}</span>
						/
						<span :style="{ color: importResult.failed > 0 ? '#ff4d4f' : '#8c8c8c' }">{{ importResult.failed }}</span>
					</a-descriptions-item>
				</a-descriptions>
				<a-table
					v-if="importResult.errors && importResult.errors.length > 0"
					size="small"
					style="margin-top: 10px"
					:columns="[
						{ title: '行号', dataIndex: 'row', width: 80 },
						{ title: '失败原因', dataIndex: 'message' }
					]"
					:data-source="importResult.errors"
					:pagination="{ pageSize: 5 }"
					row-key="row"
				/>
			</div>
		</a-space>
	</a-modal>
</template>

<script setup name="bizImportModal">
	import { message } from 'ant-design-vue'
	import downloadUtil from '@/utils/downloadUtil'

	const props = defineProps({
		title: { type: String, default: '批量导入' },
		templateApi: { type: Function, required: true },
		importApi: { type: Function, required: true }
	})
	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const fileList = ref([])
	const submitting = ref(false)
	const importResult = ref(null)

	const onOpen = () => {
		fileList.value = []
		importResult.value = null
		visible.value = true
	}

	const onClose = () => {
		visible.value = false
	}

	const beforeUpload = (file) => {
		fileList.value = [file]
		importResult.value = null
		return false
	}

	const onRemoveFile = () => {
		fileList.value = []
		importResult.value = null
	}

	const handleDownloadTemplate = () => {
		props.templateApi().then((res) => {
			downloadUtil.resultDownload(res)
		})
	}

	const doImport = (dryRun) => {
		if (fileList.value.length === 0) return
		const formData = new FormData()
		formData.append('file', fileList.value[0])
		submitting.value = true
		props
			.importApi(formData, dryRun)
			.then((res) => {
				importResult.value = res
				if (!dryRun && res && res.success > 0) {
					message.success(`导入完成：成功 ${res.success} 条，失败 ${res.failed} 条`)
					emit('successful', res)
				} else if (dryRun) {
					message.info(`预演完成：可导入 ${res.success} 条，异常 ${res.failed} 条`)
				}
			})
			.finally(() => {
				submitting.value = false
			})
	}

	defineExpose({ onOpen })
</script>
