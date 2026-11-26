<template>
	<xn-form-container
		title="代录考勤补录申请"
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
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="补录考勤日期：" name="recordDate">
						<a-date-picker v-model:value="formData.recordDate" value-format="YYYY-MM-DD" class="xn-wd" />
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="关联课程（可选）：" name="courseId">
						<a-select
							v-model:value="formData.courseId"
							:options="courseOptions"
							:field-names="{ label: 'courseName', value: 'id' }"
							placeholder="请选择课程"
							show-search
							option-filter-prop="courseName"
							allow-clear
						/>
					</a-form-item>
				</a-col>
			</a-row>
			<a-form-item label="变更内容 JSON：" name="changeJson">
				<a-textarea v-model:value="formData.changeJson" :rows="3" placeholder='{"absent_delta":-1,"note":"误记缺勤更正"}' />
			</a-form-item>
			<a-form-item label="补录原因：" name="reason">
				<a-textarea v-model:value="formData.reason" :rows="3" placeholder="请输入补录原因" />
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizMakeupRequestForm">
	import { required } from '@/utils/formRules'
	import bizMakeupRequestApi from '@/api/biz/bizMakeupRequestApi'
	import bizCourseApi from '@/api/biz/bizCourseApi'
	import bizStudentApi from '@/api/biz/bizStudentApi'

	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)
	const studentOptions = ref([])
	const courseOptions = ref([])

	const formRules = {
		studentId: [required('请选择学生')],
		recordDate: [required('请选择补录日期')],
		changeJson: [required('请输入变更内容JSON')],
		reason: [required('请输入补录原因')]
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
		formData.value = { changeJson: '{}' }
		searchStudents('')
		bizCourseApi.courseList({}).then((data) => {
			courseOptions.value = data || []
		})
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
				bizMakeupRequestApi
					.makeupRequestAdd(formData.value)
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
