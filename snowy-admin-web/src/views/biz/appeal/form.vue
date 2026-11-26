<template>
	<xn-form-container
		title="代录学生申诉工单"
		:width="520"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-form-item label="学生档案：" name="studentId">
				<a-select
					v-model:value="formData.studentId"
					:options="studentOptions"
					placeholder="请输入学号或姓名搜索"
					show-search
					:filter-option="false"
					@search="searchStudents"
					allow-clear
				/>
			</a-form-item>
			<a-form-item label="申诉类型：" name="appealType">
				<a-input v-model:value="formData.appealType" placeholder="例如：考勤申诉 / 预警申诉 / 成绩申诉" allow-clear />
			</a-form-item>
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="关联业务类型（可选）：" name="relatedType">
						<a-input v-model:value="formData.relatedType" placeholder="如 warning / daily_record" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="关联业务ID（可选）：" name="relatedId">
						<a-input v-model:value="formData.relatedId" placeholder="关联记录主键" allow-clear />
					</a-form-item>
				</a-col>
			</a-row>
			<a-form-item label="申诉内容：" name="content">
				<a-textarea v-model:value="formData.content" :rows="4" placeholder="请输入申诉详细说明" />
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizAppealForm">
	import { required } from '@/utils/formRules'
	import bizAppealApi from '@/api/biz/bizAppealApi'
	import bizStudentApi from '@/api/biz/bizStudentApi'

	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)
	const studentOptions = ref([])

	const formRules = {
		studentId: [required('请选择学生')],
		appealType: [required('请输入申诉类型')],
		content: [required('请输入申诉内容')]
	}

	const searchStudents = (searchKey) => {
		bizStudentApi.studentPage({ current: 1, size: 30, searchKey: searchKey || '' }).then((page) => {
			studentOptions.value = (page?.records || []).map((s) => ({
				label: `${s.studentNo} - ${s.name}`,
				value: s.id
			}))
		})
	}

	const onOpen = () => {
		visible.value = true
		formData.value = {}
		searchStudents('')
	}

	const onClose = () => {
		visible.value = false
		formData.value = {}
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				submitLoading.value = true
				bizAppealApi
					.appealAdd(formData.value)
					.then(() => {
						onClose()
						emit('successful')
					})
					.finally(() => {
						submitLoading.value = false
					})
			})
			.catch(() => {})
	}

	defineExpose({ onOpen })
</script>
